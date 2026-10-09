import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  return new Promise<{ status: number; ended: Promise<void>; first: string }>((resolve, reject) => {
    const req = httpsRequest({ host: '127.0.0.1', port, path: '/api/events', headers, rejectUnauthorized: false }, (res) => {
      const ended = new Promise<void>((done) => {
        res.on('end', done);
        res.on('close', done);
        res.on('error', done);
      });
      let first = '';
      res.on('data', (d) => {
        if (first.includes('"manageDevices"')) return;
        first += String(d);
        if (first.includes('"manageDevices"')) resolve({ status: res.statusCode ?? 0, ended, first });
      });
      if (res.statusCode !== 200) resolve({ status: res.statusCode ?? 0, ended, first });
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

  assert.equal(auth.revokeDevice(mine.id).found, true);
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

// ---- device management endpoints (T-009) ----

const pcHost = () => `127.0.0.1:${port}`;
/** A request from this PC: loopback socket + loopback Host, so it is the exempt `pc` and needs no login. */
function pcCall(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return raw(port, {
    https: true,
    method,
    path,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    headers: { Host: pcHost(), ...(method === 'POST' ? { Origin: `https://${pcHost()}`, 'X-Dashboard': '1' } : {}), ...headers },
  });
}
/** The same call as a signed-in LAN device (non-loopback Host). */
function deviceCall(cookieValue: string, method: string, path: string, body?: unknown) {
  return raw(port, {
    https: true,
    method,
    path,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { Host: host, Cookie: cookieValue, ...(method === 'POST' ? { Origin: `https://${host}`, 'X-Dashboard': '1' } : {}) },
  });
}
async function signInDevice(tok: string): Promise<string> {
  const r = await post('/login', `token=${encodeURIComponent(tok)}`, form);
  assert.equal(r.status, 303);
  return String(r.headers['set-cookie']).split(';')[0];
}

test('the PC creates a device; the token is returned once and appears nowhere else', async () => {
  const made = await pcCall('POST', '/api/devices', { name: '  Kitchen tablet ' });
  assert.equal(made.status, 200);
  const { id, token: tok } = JSON.parse(made.body) as { id: string; token: string };
  assert.deepEqual(Object.keys(JSON.parse(made.body)).sort(), ['id', 'token']);
  assert.ok(tok.length >= 40);

  const list = await pcCall('GET', '/api/devices');
  assert.equal(list.status, 200);
  const entry = (JSON.parse(list.body).devices as Array<Record<string, unknown>>).find((d) => d.id === id)!;
  assert.deepEqual(Object.keys(entry).sort(), ['createdMs', 'id', 'lastSeenMs', 'name']);
  assert.equal(entry.name, 'Kitchen tablet');
  for (const [name, body] of [
    ['list', list.body],
    ['state', (await pcCall('GET', '/api/state')).body],
    ['revoke response', (await pcCall('POST', '/api/devices/revoke', { id: 'nope' })).body],
  ]) assert.ok(!body.includes(tok), `${name} must not contain the token`);
  const stream = await openStream({ Host: pcHost() });
  assert.ok(!stream.first.includes(tok), 'event stream must not contain the token');
  assert.ok(!readFileSync(join(fx.dataDir, 'devices.json'), 'utf8').includes(tok), 'file holds a hash only');

  // the new token really signs in
  const cookieValue = await signInDevice(tok);
  assert.equal((await get('/api/state', { Cookie: cookieValue })).status, 200);
});

test('create validates the name with fixed error strings', async () => {
  for (const body of [{}, { name: '' }, { name: '   ' }, { name: 5 }, { name: 'x'.repeat(41) }, { name: 'a‮b' }, { name: 'a\nb' }]) {
    const r = await pcCall('POST', '/api/devices', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.deepEqual(JSON.parse(r.body), { error: 'invalid device name' });
  }
  const notObject = await pcCall('POST', '/api/devices', '[1]');
  assert.equal(notObject.status, 400);
  const big = await pcCall('POST', '/api/devices', JSON.stringify({ name: 'a'.repeat(70_000) }));
  assert.equal(big.status, 413, 'body cap applies');
});

test('the PC revokes a device: 200, then the device is gone; an unknown id is a 404 with a fixed string', async () => {
  const made = JSON.parse((await pcCall('POST', '/api/devices', { name: 'to drop' })).body) as { id: string; token: string };
  const cookieValue = await signInDevice(made.token);
  const r = await pcCall('POST', '/api/devices/revoke', { id: made.id });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), { ok: true });
  assert.equal((await get('/api/state', { Cookie: cookieValue })).status, 401, 'its session ended');
  assert.ok(!(JSON.parse((await pcCall('GET', '/api/devices')).body).devices as Array<{ id: string }>).some((d) => d.id === made.id));

  for (const body of [{ id: made.id }, { id: 'ffffffffffff' }, { id: 5 }, {}]) {
    const miss = await pcCall('POST', '/api/devices/revoke', body);
    assert.equal(miss.status, 404, JSON.stringify(body));
    assert.deepEqual(JSON.parse(miss.body), { error: 'unknown device' }, 'the id is not echoed');
  }
});

test('a signed-in LAN device gets 403 on all three endpoints and cannot even learn the device list', async () => {
  const mine = JSON.parse((await pcCall('POST', '/api/devices', { name: 'phone' })).body) as { id: string; token: string };
  const other = JSON.parse((await pcCall('POST', '/api/devices', { name: 'victim' })).body) as { id: string; token: string };
  const c = await signInDevice(mine.token);
  const calls: Array<[string, string, unknown]> = [
    ['GET', '/api/devices', undefined],
    ['POST', '/api/devices', { name: 'sneaky' }],
    ['POST', '/api/devices/revoke', { id: other.id }],
  ];
  for (const [method, path, body] of calls) {
    const r = await deviceCall(c, method, path, body);
    assert.equal(r.status, 403, `${method} ${path}`);
    assert.deepEqual(JSON.parse(r.body), { error: 'only this PC can manage devices' });
  }
  const names = (JSON.parse((await pcCall('GET', '/api/devices')).body).devices as Array<{ id: string; name: string }>).map((d) => d.name);
  assert.ok(!names.includes('sneaky'), 'nothing was created');
  assert.ok(names.includes('victim'), 'nothing was revoked');
  assert.equal((await get('/api/state', { Cookie: await signInDevice(other.token) })).status, 200);
});

test('device endpoints keep every existing request check', async () => {
  // not signed in, non-loopback Host: login required
  for (const [method, path] of [['GET', '/api/devices'], ['POST', '/api/devices'], ['POST', '/api/devices/revoke']]) {
    const r = await raw(port, { https: true, method, path, body: method === 'POST' ? '{}' : undefined, headers: { Host: host, Origin: `https://${host}`, 'X-Dashboard': '1' } });
    assert.equal(r.status, 401, `${method} ${path}`);
  }
  // from the PC: Origin, X-Dashboard and cross-site are still enforced
  for (const path of ['/api/devices', '/api/devices/revoke']) {
    const noHeader = await pcCall('POST', path, { name: 'x', id: 'x' }, { 'X-Dashboard': '' });
    assert.equal(noHeader.status, 403, `${path} without X-Dashboard`);
    const badOrigin = await pcCall('POST', path, { name: 'x', id: 'x' }, { Origin: 'https://evil.example' });
    assert.equal(badOrigin.status, 403, `${path} with a foreign Origin`);
    const noOrigin = await raw(port, { https: true, method: 'POST', path, body: '{}', headers: { Host: pcHost(), 'X-Dashboard': '1' } });
    assert.equal(noOrigin.status, 403, `${path} without Origin`);
  }
  assert.equal((await pcCall('GET', '/api/devices', undefined, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  // a non-loopback Host on the loopback socket is not the PC
  assert.equal((await get('/api/devices', { Host: `evil.example:${port}` })).status, 401);
  assert.equal((await pcCall('DELETE', '/api/devices')).status, 405);
});

test('features.manageDevices is true only for the PC, in /api/state and on the live stream', async () => {
  const mine = JSON.parse((await pcCall('POST', '/api/devices', { name: 'flag check' })).body) as { id: string; token: string };
  const c = await signInDevice(mine.token);
  const flag = (body: string) => JSON.parse(body).features.manageDevices;
  assert.equal(flag((await pcCall('GET', '/api/state')).body), true);
  assert.equal(flag((await get('/api/state', { Cookie: c })).body), false);
  const pcStream = await openStream({ Host: pcHost() });
  const devStream = await openStream({ Host: host, Cookie: c });
  assert.match(pcStream.first, /"manageDevices":true/);
  assert.match(devStream.first, /"manageDevices":false/);
});

test('a device that cannot be saved is never handed out, and a revoke that cannot be saved is reported', async () => {
  const victim = JSON.parse((await pcCall('POST', '/api/devices', { name: 'victim 2' })).body) as { id: string; token: string };
  const c = await signInDevice(victim.token);
  const file = join(fx.dataDir, 'devices.json');
  const before = (JSON.parse((await pcCall('GET', '/api/devices')).body).devices as unknown[]).length;
  rmSync(file, { force: true });
  mkdirSync(file); // renaming onto a directory fails
  try {
    const made = await pcCall('POST', '/api/devices', { name: 'unsaved' });
    assert.equal(made.status, 500);
    assert.deepEqual(JSON.parse(made.body), { error: 'could not save the device' });
    assert.ok(!made.body.includes('token'), 'no token in the error');
    assert.equal((JSON.parse((await pcCall('GET', '/api/devices')).body).devices as unknown[]).length, before, 'nothing was kept');

    const revoked = await pcCall('POST', '/api/devices/revoke', { id: victim.id });
    assert.equal(revoked.status, 500);
    assert.deepEqual(JSON.parse(revoked.body), { error: 'device revoked, but the change could not be saved' });
    assert.equal((await get('/api/state', { Cookie: c })).status, 401, 'the session still ended');
  } finally {
    rmSync(file, { recursive: true, force: true });
  }
  // writable again: the next change persists the whole current state
  assert.equal((await pcCall('POST', '/api/devices', { name: 'after' })).status, 200);
});

test('device management writes audit entries without the token', async () => {
  const log = join(fx.dataDir, 'commands.log');
  const made = JSON.parse((await pcCall('POST', '/api/devices', { name: 'audited' })).body) as { id: string; token: string };
  await pcCall('POST', '/api/devices/revoke', { id: made.id });
  const text = readFileSync(log, 'utf8');
  assert.ok(!text.includes(made.token), 'the token is never logged');
  const entries = text.trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
  const create = entries.find((e) => e.action === 'device-create' && e.id === made.id)!;
  assert.deepEqual([create.device, create.name, create.ok], ['pc', 'audited', true]);
  const revoke = entries.find((e) => e.action === 'device-revoke' && e.id === made.id)!;
  assert.deepEqual([revoke.device, revoke.name, revoke.found, revoke.persisted], ['pc', 'audited', true, true]);
});

test('the device cap answers 409 with a fixed string', async () => {
  const have = (JSON.parse((await pcCall('GET', '/api/devices')).body).devices as unknown[]).length;
  for (let i = have; i < 100; i++) devices.create(`filler ${i}`);
  const r = await pcCall('POST', '/api/devices', { name: 'one too many' });
  assert.equal(r.status, 409);
  assert.deepEqual(JSON.parse(r.body), { error: 'at most 100 devices' });
});
