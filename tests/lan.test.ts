import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFixture, raw } from './helpers.ts';

const fx = makeFixture();
// Never read the real team-hq board: a ticket in review would add alerts.
process.env.TEAM_HQ_DIR = join(fx.root, 'no-team-hq');
// A fake Claude CLI, so a signed-in device can start a task and the audit log gets a real entry.
process.env.CLAUDE_BIN = process.execPath;
process.env.CLAUDE_BIN_ARGS = JSON.stringify([fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))]);
process.env.FAKE_CLAUDE_LOG = join(fx.root, 'cli.log');
mkdirSync(join(fx.projectsRoot, 'Alpha'));
const publicDir = join(fx.root, 'public');
mkdirSync(publicDir);
writeFileSync(join(publicDir, 'index.html'), '<!doctype html><title>dash</title>');
writeFileSync(join(publicDir, 'login.html'), '<!doctype html><title>login</title>');
writeFileSync(join(publicDir, 'pair.html'), '<!doctype html><main data-state="__STATE__">Sign in as <b>__DEVICE__</b>?</main>');
writeFileSync(join(publicDir, 'style.css'), 'body{}');
writeFileSync(join(fx.root, 'secret.txt'), 'nope');

const { createDashboardServer } = await import('../src/server/server.ts');
const { createAuth } = await import('../src/server/auth.ts');
const { createDeviceStore } = await import('../src/server/devices.ts');
const { recordFailedSignin } = await import('../src/server/alerts.ts');
const { ensureCert } = await import('../src/server/tls.ts');

const devices = createDeviceStore(fx.dataDir);
const { token, id: deviceId } = devices.create('test phone');
// The same wiring as the real server, with a clock the expiry test can move forward.
const clock = { skew: 0 };
const auth = createAuth(devices, { onFailedLogin: recordFailedSignin, now: () => Date.now() + clock.skew });
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
  assert.deepEqual([create.device, create.deviceId, create.name, create.ok], ['This PC', 'pc', 'audited', true]);
  const revoke = entries.find((e) => e.action === 'device-revoke' && e.id === made.id)!;
  assert.deepEqual([revoke.device, revoke.deviceId, revoke.name, revoke.found, revoke.persisted], ['This PC', 'pc', 'audited', true, true]);
});

test('the device cap answers 409 with a fixed string', async () => {
  const have = (JSON.parse((await pcCall('GET', '/api/devices')).body).devices as unknown[]).length;
  for (let i = have; i < 100; i++) devices.create(`filler ${i}`);
  const r = await pcCall('POST', '/api/devices', { name: 'one too many' });
  assert.equal(r.status, 409);
  assert.deepEqual(JSON.parse(r.body), { error: 'at most 100 devices' });
});

// ---- failed sign-in alerts (T-014) ----

test('failed sign-ins show up as one alert per source address, are dismissable, and never carry the attempted token', async () => {
  const signinAlerts = async () =>
    (JSON.parse((await pcCall('GET', '/api/state')).body).alerts.items as Array<{ id: string; kind: string; title: string; detail: string }>).filter((a) => a.kind === 'signin');
  const dismiss = (id: string) => pcCall('POST', '/api/alerts/dismiss', { id });
  for (const a of await signinAlerts()) assert.equal((await dismiss(a.id)).status, 200); // earlier tests also failed a login

  const secret = 'guess-' + 'q'.repeat(30);
  for (let i = 0; i < 2; i++) assert.equal((await post('/login', `token=${secret}`, form)).headers.location, '/login?e=1');
  const [a, ...rest] = await signinAlerts();
  assert.equal(rest.length, 0, 'one alert for the one source address');
  assert.equal(a.id, 'signin:127.0.0.1', 'the socket address, not a header');
  assert.match(a.detail, /^127[.]0[.]0[.]1 · 2 failed attempts · last at [0-9]{2}:[0-9]{2}:[0-9]{2}$/);
  const state = (await pcCall('GET', '/api/state')).body;
  assert.ok(!state.includes(secret), 'the attempted token is never kept');
  assert.ok(!(await openStream({ Host: pcHost() })).first.includes(secret));

  // a forwarded header does not change the source
  await post('/login', 'token=nope', { ...form, 'X-Forwarded-For': '6.6.6.6' });
  const after = await signinAlerts();
  assert.deepEqual(after.map((x) => x.id), ['signin:127.0.0.1']);
  assert.match(after[0].detail, /3 failed attempts/);

  assert.equal((await dismiss(a.id)).status, 200);
  assert.deepEqual(await signinAlerts(), []);
  await post('/login', 'token=again', form);
  const reopened = await signinAlerts();
  assert.equal(reopened.length, 1);
  assert.match(reopened[0].detail, /1 failed attempt /);
  await dismiss(reopened[0].id);
});

// ---- QR pairing (T-011) ----

/** Creates a device; the earlier cap test leaves the store full of fillers, so those are cleared first when needed. */
const newDevice = async (name: string) => {
  let r = await pcCall('POST', '/api/devices', { name });
  if (r.status === 409) {
    for (const d of JSON.parse((await pcCall('GET', '/api/devices')).body).devices as Array<{ id: string; name: string }>) {
      if (d.name.startsWith('filler')) await pcCall('POST', '/api/devices/revoke', { id: d.id });
    }
    r = await pcCall('POST', '/api/devices', { name });
  }
  assert.equal(r.status, 200, r.body);
  return JSON.parse(r.body) as { id: string; token: string };
};
const formHdr = { 'Content-Type': 'application/x-www-form-urlencoded' };
/** What the confirm page's button does: POST the code from the link. */
const confirm = (path: string) => post('/pair', 'c=' + encodeURIComponent(new URL(path, 'https://x').searchParams.get('c') ?? ''), formHdr);
const pairOf = async (id: string) => JSON.parse((await pcCall('POST', '/api/devices/pair', { id })).body) as { path: string; urls: string[]; expiresMs: number };

test('the PC issues a pairing link that contains a one-time code and never the device token', async () => {
  const dev = await newDevice('qr phone');
  const r = await pcCall('POST', '/api/devices/pair', { id: dev.id });
  assert.equal(r.status, 200);
  const info = JSON.parse(r.body) as { path: string; urls: string[]; expiresMs: number };
  assert.deepEqual(Object.keys(info).sort(), ['expiresMs', 'path', 'urls']);
  assert.match(info.path, /^\/pair\?c=[A-Za-z0-9_-]{40,}$/);
  assert.ok(info.expiresMs > Date.now() + 9 * 60_000 && info.expiresMs <= Date.now() + 10 * 60_000 + 1000, 'valid for 10 minutes');
  for (const u of info.urls) assert.ok(u.startsWith('https://') && u.endsWith(`:${port}${info.path}`), u);
  assert.ok(!r.body.includes(dev.token), 'the device token is not in the link');
  assert.ok(!(await pcCall('GET', '/api/devices')).body.includes(info.path.slice(8)), 'the code is not listed anywhere');
  assert.ok(!readFileSync(join(fx.dataDir, 'devices.json'), 'utf8').includes(info.path.slice(8)), 'nor stored on disk');
});

test('opening the link only shows a confirm page; the button signs the browser in once', async () => {
  const dev = await newDevice('qr phone 2');
  const { path } = await pairOf(dev.id);
  // a camera app or link preview fetching the URL (twice) changes nothing
  for (let i = 0; i < 2; i++) {
    const page = await get(path); // a phone: non-loopback Host, no cookie
    assert.equal(page.status, 200);
    assert.equal(page.headers['cache-control'], 'no-store');
    assert.equal(page.headers['set-cookie'], undefined);
    assert.match(page.body, /data-state="ok"/);
    assert.match(page.body, /Sign in as <b>qr phone 2<\/b>\?/);
  }
  const ok = await confirm(path);
  assert.equal(ok.status, 200);
  const set = String(ok.headers['set-cookie']);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict']) assert.match(set, new RegExp(flag));
  const c = set.split(';')[0];
  assert.equal((await get('/api/state', { Cookie: c })).status, 200);
  assert.equal((await deviceCall(c, 'GET', '/api/devices')).status, 403, 'a paired phone is a normal device, not the PC');

  const again = await confirm(path);
  assert.equal(again.status, 401);
  assert.equal(again.headers['set-cookie'], undefined);
  assert.match((await get(path)).body, /data-state="bad"/, 'the page now says the code is gone');
  // the session from the first sign-in is unaffected
  assert.equal((await get('/api/state', { Cookie: c })).status, 200);
});

test('the confirm page escapes the device name', async () => {
  const dev = await newDevice('<img src=x onerror=1>');
  const page = await get((await pairOf(dev.id)).path);
  assert.ok(!page.body.includes('<img'), page.body);
  assert.match(page.body, /&#60;img/);
});

test('unknown, malformed and missing codes show the error page, and failed POSTs raise a failed-sign-in alert', async () => {
  const signinCount = async () =>
    (JSON.parse((await pcCall('GET', '/api/state')).body).alerts.items as Array<{ id: string; kind: string }>).filter((a) => a.kind === 'signin').length;
  for (const a of await (async () => (JSON.parse((await pcCall('GET', '/api/state')).body).alerts.items as Array<{ id: string; kind: string }>).filter((x) => x.kind === 'signin'))()) {
    await pcCall('POST', '/api/alerts/dismiss', { id: a.id });
  }
  assert.equal(await signinCount(), 0);
  for (const p of ['/pair?c=' + 'A'.repeat(43), '/pair?c=', '/pair']) {
    const page = await get(p);
    assert.equal(page.status, 200, p);
    assert.match(page.body, /data-state="bad"/, p);
    assert.equal(page.headers['set-cookie'], undefined, p);
  }
  assert.equal(await signinCount(), 0, 'looking at the page is not a sign-in attempt');
  for (const body of ['c=' + 'A'.repeat(43), 'c=', '']) {
    const r = await post('/pair', body, formHdr);
    assert.equal(r.status, 401, body);
    assert.equal(r.headers['set-cookie'], undefined, body);
    assert.deepEqual(JSON.parse(r.body), { error: 'invalid or used code' });
  }
  assert.equal(await signinCount(), 1, 'one alert for the one source address');
  const detail = (JSON.parse((await pcCall('GET', '/api/state')).body).alerts.items as Array<{ kind: string; detail: string }>).find((a) => a.kind === 'signin')!.detail;
  assert.match(detail, /3 failed attempts/);
  assert.ok(!detail.includes('AAAA'), 'the tried code is not kept');
  // a good sign-in afterwards clears the rate-limit budget
  const dev = await newDevice('after failures');
  assert.equal((await confirm((await pairOf(dev.id)).path)).status, 200);
});

test('POST /pair is held to the same-origin check', async () => {
  const dev = await newDevice('post probe');
  const { path } = await pairOf(dev.id);
  const code = new URL(path, 'https://x').searchParams.get('c');
  const r = await raw(port, { https: true, method: 'POST', path: '/pair', body: 'c=' + code, headers: { Host: host, Origin: 'https://evil.example', ...formHdr } });
  assert.equal(r.status, 403);
  assert.equal(r.headers['set-cookie'], undefined);
  const noOrigin = await raw(port, { https: true, method: 'POST', path: '/pair', body: 'c=' + code, headers: { Host: host, ...formHdr } });
  assert.equal(noOrigin.status, 403);
  assert.equal((await confirm(path)).status, 200, 'the code was not spent by the refused POSTs');
});

test('revoking a device invalidates its unused pairing code', async () => {
  const dev = await newDevice('revoked before scan');
  const { path } = await pairOf(dev.id);
  assert.equal((await pcCall('POST', '/api/devices/revoke', { id: dev.id })).status, 200);
  assert.match((await get(path)).body, /data-state="bad"/);
  const r = await confirm(path);
  assert.equal(r.status, 401);
  assert.equal(r.headers['set-cookie'], undefined);
});

test('only the PC can issue pairing links, with all request checks and fixed errors', async () => {
  const dev = await newDevice('guard');
  const c = await signInDevice((await newDevice('other')).token);
  const asDevice = await deviceCall(c, 'POST', '/api/devices/pair', { id: dev.id });
  assert.equal(asDevice.status, 403);
  assert.deepEqual(JSON.parse(asDevice.body), { error: 'only this PC can manage devices' });
  const anon = await raw(port, { https: true, method: 'POST', path: '/api/devices/pair', body: '{}', headers: { Host: host, Origin: `https://${host}`, 'X-Dashboard': '1' } });
  assert.equal(anon.status, 401);
  assert.equal((await pcCall('POST', '/api/devices/pair', { id: dev.id }, { 'X-Dashboard': '' })).status, 403);
  assert.equal((await pcCall('POST', '/api/devices/pair', { id: dev.id }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await pcCall('GET', '/api/devices/pair')).status, 405);
  for (const body of [{}, { id: 5 }, { id: 'ffffffffffff' }]) {
    const r = await pcCall('POST', '/api/devices/pair', body);
    assert.equal(r.status, 404, JSON.stringify(body));
    assert.deepEqual(JSON.parse(r.body), { error: 'unknown device' });
  }
  assert.equal((await pcCall('POST', '/api/devices/pair', JSON.stringify({ id: 'x'.repeat(70_000) }))).status, 413, 'body cap applies');
});

test('pairing links are audited without the code', async () => {
  const dev = await newDevice('audited pairing');
  const { path } = await pairOf(dev.id);
  const text = readFileSync(join(fx.dataDir, 'commands.log'), 'utf8');
  assert.ok(!text.includes(path.slice(8)), 'the code is never logged');
  const entry = text.trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>).filter((e) => e.action === 'device-pair' && e.id === dev.id);
  assert.equal(entry.length, 1);
  assert.deepEqual([entry[0].device, entry[0].deviceId, entry[0].ok], ['This PC', 'pc', true]);
});

// ---- audit log by device (T-012) ----

type AuditRow = { ts: string; action: string; device?: string; deviceId?: string; project?: string; mode?: string; ok?: boolean; prompt?: string };
const auditOf = async (query = '') => JSON.parse((await pcCall('GET', '/api/audit' + query)).body).entries as AuditRow[];

test('every logged action names the device (name and id); the PC is "This PC" / pc', async () => {
  const phone = await newDevice('Kitchen phone');
  const c = await signInDevice(phone.token);
  const started = await deviceCall(c, 'POST', '/api/commands', { project: 'Alpha', prompt: 'hello from the phone', permissionMode: 'plan' });
  assert.equal(started.status, 200, started.body);
  const made = await newDevice('audit target');
  await pcCall('POST', '/api/devices/revoke', { id: made.id });
  await pairOf((await newDevice('audit pair')).id);

  const entries = await auditOf();
  const start = entries.find((e) => e.action === 'start' && e.deviceId === phone.id)!;
  assert.deepEqual([start.device, start.deviceId, start.project, start.mode, start.ok, start.prompt], ['Kitchen phone', phone.id, 'Alpha', 'plan', true, 'hello from the phone']);
  for (const action of ['device-create', 'device-revoke', 'device-pair']) {
    const e = entries.find((x) => x.action === action)!;
    assert.deepEqual([e.device, e.deviceId], ['This PC', 'pc'], action);
  }
  // every line the server wrote after this change names a device
  const raw = readFileSync(join(fx.dataDir, 'commands.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
  assert.ok(raw.length >= 4);
  for (const e of raw) assert.ok(typeof e.device === 'string' && typeof e.deviceId === 'string', JSON.stringify(e));
});

test('GET /api/audit: any signed-in device may read it, newest first, filtered by device id, allowlisted fields only', async () => {
  const phone = await newDevice('Reader');
  const c = await signInDevice(phone.token);
  const asDevice = await deviceCall(c, 'GET', '/api/audit');
  assert.equal(asDevice.status, 200, 'a LAN device may read the log');
  assert.deepEqual(Object.keys(JSON.parse(asDevice.body)), ['entries']);
  const all = JSON.parse(asDevice.body).entries as AuditRow[];
  assert.ok(all.length >= 4);
  const times = all.map((e) => Date.parse(e.ts));
  assert.deepEqual(times, [...times].sort((a, b) => b - a), 'newest first');

  const onlyPc = await auditOf('?device=pc');
  assert.ok(onlyPc.length > 0 && onlyPc.every((e) => e.deviceId === 'pc'));
  const onlyPhone = JSON.parse((await deviceCall(c, 'GET', '/api/audit?device=' + (await (async () => (JSON.parse((await pcCall('GET', '/api/devices')).body).devices as Array<{ id: string; name: string }>).find((d) => d.name === 'Kitchen phone')!.id)()))).body).entries as AuditRow[];
  assert.ok(onlyPhone.length >= 1 && onlyPhone.every((e) => e.device === 'Kitchen phone'));
  assert.deepEqual(await auditOf('?device=ffffffffffff'), []);

  // nothing but the allowlisted fields: no ip, no target ids/names, no codes
  const allowed = new Set(['ts', 'action', 'device', 'deviceId', 'project', 'session', 'mode', 'ok', 'prompt']);
  for (const e of all) for (const k of Object.keys(e)) assert.ok(allowed.has(k), k);
  assert.ok(!asDevice.body.includes('127.0.0.1') && !asDevice.body.includes('pair?c='));
});

test('GET /api/audit keeps every request check and answers with fixed strings', async () => {
  assert.equal((await get('/api/audit')).status, 401, 'login required');
  assert.equal((await pcCall('GET', '/api/audit', undefined, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  for (const bad of ['?device=', '?device=a%20b', '?device=' + 'x'.repeat(65), '?device=..%2f..%2fsecret', '?device=a;b']) {
    const r = await pcCall('GET', '/api/audit' + bad);
    assert.equal(r.status, 400, bad);
    assert.deepEqual(JSON.parse(r.body), { error: 'invalid device filter' });
  }
  assert.equal((await pcCall('POST', '/api/audit', {})).status, 404, 'read-only');
  // an unreadable log: a fixed message, no path or error text
  const log = join(fx.dataDir, 'commands.log');
  const saved = readFileSync(log);
  rmSync(log);
  mkdirSync(log);
  try {
    const r = await pcCall('GET', '/api/audit');
    assert.equal(r.status, 500);
    assert.deepEqual(JSON.parse(r.body), { error: 'could not read the audit log' });
  } finally {
    rmSync(log, { recursive: true, force: true });
    writeFileSync(log, saved);
  }
});

// ---- session hardening (T-015): streams end with their session ----

const settledWithin = (p: Promise<void>, ms: number) => Promise.race([p.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), ms))]);

test('logging out closes the live streams opened with that session, and only those', async () => {
  const dev = await newDevice('logout streams');
  const other = await newDevice('bystander');
  const c1 = await signInDevice(dev.token);
  const c2 = await signInDevice(dev.token); // a second browser of the same device
  const c3 = await signInDevice(other.token);
  const s1 = await openStream({ Host: host, Cookie: c1 });
  const s2 = await openStream({ Host: host, Cookie: c2 });
  const s3 = await openStream({ Host: host, Cookie: c3 });
  const pc = await openStream({ Host: pcHost() });
  assert.deepEqual([s1.status, s2.status, s3.status, pc.status], [200, 200, 200, 200]);

  const out = await post('/logout', '', { Cookie: c1 });
  assert.equal(out.status, 303);
  assert.equal(await settledWithin(s1.ended, 1000), true, 'the stream of the session that logged out is closed');
  assert.equal(await settledWithin(s2.ended, 500), false, 'another session of the same device stays');
  assert.equal(await settledWithin(s3.ended, 100), false, 'another device stays');
  assert.equal(await settledWithin(pc.ended, 100), false, 'the PC stays');
  assert.equal((await get('/api/state', { Cookie: c2 })).status, 200);
});

test('the 11th sign-in of a device ends its oldest session and that session\'s stream', async () => {
  const dev = await newDevice('session cap');
  const first = await signInDevice(dev.token);
  const oldest = await openStream({ Host: host, Cookie: first });
  assert.equal(oldest.status, 200);
  const rest: string[] = [];
  for (let i = 0; i < 9; i++) rest.push(await signInDevice(dev.token));
  assert.equal(await settledWithin(oldest.ended, 300), false, 'ten sessions are allowed');
  rest.push(await signInDevice(dev.token));
  assert.equal(await settledWithin(oldest.ended, 1000), true, 'the eleventh ended the oldest');
  assert.equal((await get('/api/state', { Cookie: first })).status, 401);
  for (const c of rest) assert.equal((await get('/api/state', { Cookie: c })).status, 200);
});

test('a session that runs out closes its stream within a tick, while the PC stream stays', async () => {
  const dev = await newDevice('expiry streams');
  const c = await signInDevice(dev.token);
  const s = await openStream({ Host: host, Cookie: c });
  const pc = await openStream({ Host: pcHost() });
  assert.equal(s.status, 200);
  clock.skew = 8 * 86_400_000; // 8 days pass without a request
  try {
    assert.equal(await settledWithin(s.ended, 5000), true, 'closed by the next 2 s tick, no request needed');
    assert.equal(await settledWithin(pc.ended, 100), false);
    assert.equal((await get('/api/state', { Cookie: c })).status, 401);
  } finally {
    clock.skew = 0;
  }
});
