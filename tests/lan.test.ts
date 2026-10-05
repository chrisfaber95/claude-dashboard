import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { makeFixture, raw } from './helpers.ts';

const fx = makeFixture();
const publicDir = join(fx.root, 'public');
mkdirSync(publicDir);
writeFileSync(join(publicDir, 'index.html'), '<!doctype html><title>dash</title>');
writeFileSync(join(publicDir, 'login.html'), '<!doctype html><title>login</title>');
writeFileSync(join(publicDir, 'style.css'), 'body{}');
writeFileSync(join(fx.root, 'secret.txt'), 'nope');

const { createDashboardServer } = await import('../src/server/server.ts');
const { createAuth, loadOrCreateToken } = await import('../src/server/auth.ts');
const { ensureCert } = await import('../src/server/tls.ts');

const { token } = loadOrCreateToken(fx.dataDir);
const server = createDashboardServer({ publicDir, auth: createAuth(token), tls: ensureCert(fx.dataDir), commands: true });
let port = 0;
let host = '';
let cookie = '';

before(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
  host = `192.168.1.50:${port}`; // what a phone on the LAN would send
});
after(() => {
  server.closeAllConnections();
  server.close();
});

const get = (path: string, headers: Record<string, string> = {}) => raw(port, { https: true, path, headers: { Host: host, ...headers } });
const post = (path: string, body: string, headers: Record<string, string> = {}) =>
  raw(port, { https: true, method: 'POST', path, body, headers: { Host: host, Origin: `https://${host}`, ...headers } });

test('serves over HTTPS and requires login for pages and API', async () => {
  assert.equal((await get('/api/state')).status, 401);
  const page = await get('/');
  assert.equal(page.status, 302);
  assert.equal(page.headers.location, '/login');
  assert.equal((await get('/login')).status, 200);
  assert.equal((await get('/style.css')).status, 200);
  assert.equal((await get('/login.html')).status, 302, 'only /login itself is public');
});

test('wrong token is rejected', async () => {
  const r = await post('/login', 'token=wrong', { 'Content-Type': 'application/x-www-form-urlencoded' });
  assert.equal(r.status, 303);
  assert.equal(r.headers.location, '/login?e=1');
  assert.equal(r.headers['set-cookie'], undefined);
});

test('login from a foreign origin is refused', async () => {
  const r = await post('/login', `token=${token}`, { Origin: 'https://evil.example' });
  assert.equal(r.status, 403);
});

test('correct token sets a secure session cookie that unlocks the API', async () => {
  const r = await post('/login', `token=${encodeURIComponent(token)}`, { 'Content-Type': 'application/x-www-form-urlencoded' });
  assert.equal(r.status, 303);
  assert.equal(r.headers.location, '/');
  const set = String(r.headers['set-cookie']);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict']) assert.match(set, new RegExp(flag));
  cookie = set.split(';')[0];

  const state = await get('/api/state', { Cookie: cookie });
  assert.equal(state.status, 200);
  const j = JSON.parse(state.body);
  assert.equal(j.features.lan !== undefined, true);
  assert.ok(!state.body.includes(token), 'login token never appears in API output');
  assert.equal((await get('/', { Cookie: cookie })).status, 200);
  assert.equal(state.headers['x-frame-options'], 'DENY');
});

test('API POSTs need the right origin and the X-Dashboard header', async () => {
  const body = JSON.stringify({ project: 'Nope', prompt: 'x' });
  const noHeader = await post('/api/commands', body, { Cookie: cookie });
  assert.equal(noHeader.status, 403);
  const badOrigin = await post('/api/commands', body, { Cookie: cookie, 'X-Dashboard': '1', Origin: 'https://evil.example' });
  assert.equal(badOrigin.status, 403);
  const noOrigin = await raw(port, { https: true, method: 'POST', path: '/api/commands', body, headers: { Host: host, Cookie: cookie, 'X-Dashboard': '1' } });
  assert.equal(noOrigin.status, 403);
  const ok = await post('/api/commands', body, { Cookie: cookie, 'X-Dashboard': '1' });
  assert.equal(ok.status, 400, 'reaches validation (unknown project)');
});

test('path traversal stays blocked over HTTPS', async () => {
  for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%5csecret.txt']) {
    const r = await get(p, { Cookie: cookie });
    assert.notEqual(r.body, 'nope', p);
  }
});

test('logout revokes the session', async () => {
  const r = await post('/logout', '', { Cookie: cookie });
  assert.equal(r.status, 303);
  assert.equal((await get('/api/state', { Cookie: cookie })).status, 401);
});

test('security headers allow same-origin form posts and set a strict CSP', async () => {
  const r = await get('/login');
  assert.equal(r.headers['referrer-policy'], 'same-origin', 'no-referrer would make browsers send Origin: null on the login form');
  assert.match(String(r.headers['content-security-policy']), /default-src 'self'/);
  assert.doesNotMatch(String(r.headers['content-security-policy']), /script-src[^;]*unsafe-inline/);
  assert.equal((await get('/login.js')).status, 404, 'public without login (404 only because the fixture has no file)');
});

test('cross-site requests never reach the API', async () => {
  const r = await get('/api/state', { Cookie: 'x=1', 'Sec-Fetch-Site': 'cross-site' });
  assert.equal(r.status, 403);
});
