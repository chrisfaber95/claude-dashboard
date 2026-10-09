import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { makeFixture, raw } from './helpers.ts';

const fx = makeFixture();
// Never read the real team-hq board: a ticket in review would add alerts.
process.env.TEAM_HQ_DIR = join(fx.root, 'no-team-hq');
const publicDir = join(fx.root, 'public');
mkdirSync(publicDir);
writeFileSync(join(publicDir, 'index.html'), '<!doctype html><title>dash</title>');
writeFileSync(join(publicDir, 'login.html'), '<!doctype html><title>login</title>');
writeFileSync(join(publicDir, 'style.css'), 'body{}');
writeFileSync(join(fx.root, 'secret.txt'), 'nope');

const { createDashboardServer } = await import('../src/server/server.ts');
const { createAuth } = await import('../src/server/auth.ts');
const { createDeviceStore } = await import('../src/server/devices.ts');
const { ensureCert } = await import('../src/server/tls.ts');

const devices = createDeviceStore(fx.dataDir);
const { token, id: deviceId } = devices.create('test phone');
const auth = createAuth(devices);
const server = createDashboardServer({ publicDir, auth, tls: ensureCert(fx.dataDir), commands: true });
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

test('alert endpoints need the login', async () => {
  for (const path of ['/api/alerts/dismiss', '/api/settings/alerts']) {
    const anon = await post(path, '{}', { 'X-Dashboard': '1' });
    assert.equal(anon.status, 401, path);
    const authed = await post(path, '{}', { Cookie: cookie, 'X-Dashboard': '1' });
    assert.equal(authed.status, 400, `${path} reaches validation with a session`);
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

test('this PC (loopback socket and loopback Host) needs no token; anything else still does', async () => {
  for (const h of [`127.0.0.1:${port}`, `localhost:${port}`]) {
    assert.equal((await get('/api/state', { Host: h })).status, 200, h);
    assert.equal((await get('/', { Host: h })).status, 200, h);
  }
  // The socket is loopback here, so a non-loopback Host must not be exempt.
  for (const h of [host, `evil.example:${port}`, `127.0.0.1.evil.example:${port}`]) {
    assert.equal((await get('/api/state', { Host: h })).status, 401, h);
    assert.equal((await get('/', { Host: h })).status, 302, h);
  }
  // Forwarding headers don't help.
  assert.equal((await get('/api/state', { 'X-Forwarded-For': '127.0.0.1', Forwarded: 'for=127.0.0.1' })).status, 401);
});

/** Open /api/events; resolves once the first event (or an error status) arrives. */
function openStream(headers: Record<string, string>) {
  return new Promise<{ status: number; ended: Promise<void> }>((resolve, reject) => {
    const req = httpsRequest({ host: '127.0.0.1', port, path: '/api/events', headers, rejectUnauthorized: false }, (res) => {
      const ended = new Promise<void>((done) => {
        res.on('end', done);
        res.on('close', done);
        res.on('error', done);
      });
      res.once('data', () => resolve({ status: res.statusCode ?? 0, ended }));
      if (res.statusCode !== 200) resolve({ status: res.statusCode ?? 0, ended });
    });
    req.on('error', reject);
    req.end();
  });
}

const settled = (p: Promise<void>) => Promise.race([p.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 700))]);
const form = { 'Content-Type': 'application/x-www-form-urlencoded' };

test('revoking a device ends its session and closes its live-event streams at once, leaving others alone', async () => {
  const mine = devices.create('to revoke');
  const kept = devices.create('kept');
  const signIn = async (tok: string) => {
    const r = await post('/login', `token=${encodeURIComponent(tok)}`, form);
    assert.equal(r.status, 303);
    return String(r.headers['set-cookie']).split(';')[0];
  };
  const c1 = await signIn(mine.token);
  const c2 = await signIn(kept.token);
  const s1 = await openStream({ Host: host, Cookie: c1 });
  const s2 = await openStream({ Host: host, Cookie: c2 });
  const pc = await openStream({ Host: `127.0.0.1:${port}` });
  assert.deepEqual([s1.status, s2.status, pc.status], [200, 200, 200]);

  assert.equal(auth.revokeDevice(mine.id), true);
  assert.equal(await settled(s1.ended), true, 'the revoked device stream is closed');
  assert.equal(await settled(s2.ended), false, 'the other device stream stays open');
  assert.equal(await settled(pc.ended), false, 'the PC stream stays open');
  assert.equal((await get('/api/state', { Cookie: c1 })).status, 401);
  assert.equal((await get('/api/state', { Cookie: c2 })).status, 200);
  assert.equal((await openStream({ Host: host, Cookie: c1 })).status, 401, 'no new stream either');
  const again = await post('/login', `token=${encodeURIComponent(mine.token)}`, form);
  assert.equal(again.headers.location, '/login?e=1', 'the revoked token no longer signs in');
  assert.ok(devices.has(deviceId), 'the main test device is unaffected');
});
