// Device management endpoints, failed sign-in alerts and the device cap.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { raw } from '../helpers.ts';
import { fx, devices, token, port, host, get, post, openStream, form, pcHost, pcCall, deviceCall, signInDevice } from './lan-test-setup.ts';

test('the PC creates a device; the token is returned once and appears nowhere else', async () => {
  const made = await pcCall('POST', '/api/devices', { name: '  Kitchen tablet ' });
  assert.equal(made.status, 200);
  const { id, token: tok } = JSON.parse(made.body) as { id: string; token: string };
  assert.deepEqual(Object.keys(JSON.parse(made.body)).sort(), ['id', 'token']);
  assert.ok(tok.length >= 40);

  const list = await pcCall('GET', '/api/devices');
  assert.equal(list.status, 200);
  const entry = (JSON.parse(list.body).devices as Array<Record<string, unknown>>).find((device) => device.id === id)!;
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
    const response = await pcCall('POST', '/api/devices', body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.deepEqual(JSON.parse(response.body), { error: 'invalid device name' });
  }
  const notObject = await pcCall('POST', '/api/devices', '[1]');
  assert.equal(notObject.status, 400);
  const big = await pcCall('POST', '/api/devices', JSON.stringify({ name: 'a'.repeat(70_000) }));
  assert.equal(big.status, 413, 'body cap applies');
});

test('the PC revokes a device: 200, then the device is gone; an unknown id is a 404 with a fixed string', async () => {
  const made = JSON.parse((await pcCall('POST', '/api/devices', { name: 'to drop' })).body) as { id: string; token: string };
  const cookieValue = await signInDevice(made.token);
  const response = await pcCall('POST', '/api/devices/revoke', { id: made.id });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true });
  assert.equal((await get('/api/state', { Cookie: cookieValue })).status, 401, 'its session ended');
  assert.ok(!(JSON.parse((await pcCall('GET', '/api/devices')).body).devices as Array<{ id: string }>).some((device) => device.id === made.id));

  for (const body of [{ id: made.id }, { id: 'ffffffffffff' }, { id: 5 }, {}]) {
    const miss = await pcCall('POST', '/api/devices/revoke', body);
    assert.equal(miss.status, 404, JSON.stringify(body));
    assert.deepEqual(JSON.parse(miss.body), { error: 'unknown device' }, 'the id is not echoed');
  }
});

test('a signed-in LAN device gets 403 on all three endpoints and cannot even learn the device list', async () => {
  const mine = JSON.parse((await pcCall('POST', '/api/devices', { name: 'phone' })).body) as { id: string; token: string };
  const other = JSON.parse((await pcCall('POST', '/api/devices', { name: 'victim' })).body) as { id: string; token: string };
  const deviceCookie = await signInDevice(mine.token);
  const calls: Array<[string, string, unknown]> = [
    ['GET', '/api/devices', undefined],
    ['POST', '/api/devices', { name: 'sneaky' }],
    ['POST', '/api/devices/revoke', { id: other.id }],
  ];
  for (const [method, path, body] of calls) {
    const response = await deviceCall(deviceCookie, method, path, body);
    assert.equal(response.status, 403, `${method} ${path}`);
    assert.deepEqual(JSON.parse(response.body), { error: 'only this PC can manage devices' });
  }
  const names = (JSON.parse((await pcCall('GET', '/api/devices')).body).devices as Array<{ id: string; name: string }>).map((device) => device.name);
  assert.ok(!names.includes('sneaky'), 'nothing was created');
  assert.ok(names.includes('victim'), 'nothing was revoked');
  assert.equal((await get('/api/state', { Cookie: await signInDevice(other.token) })).status, 200);
});

test('device endpoints keep every existing request check', async () => {
  // not signed in, non-loopback Host: login required
  for (const [method, path] of [['GET', '/api/devices'], ['POST', '/api/devices'], ['POST', '/api/devices/revoke']]) {
    const response = await raw(port, { https: true, method, path, body: method === 'POST' ? '{}' : undefined, headers: { Host: host, Origin: `https://${host}`, 'X-Dashboard': '1' } });
    assert.equal(response.status, 401, `${method} ${path}`);
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
  const call = await signInDevice(mine.token);
  const flag = (body: string) => JSON.parse(body).features.manageDevices;
  assert.equal(flag((await pcCall('GET', '/api/state')).body), true);
  assert.equal(flag((await get('/api/state', { Cookie: call })).body), false);
  const pcStream = await openStream({ Host: pcHost() });
  const devStream = await openStream({ Host: host, Cookie: call });
  assert.match(pcStream.first, /"manageDevices":true/);
  assert.match(devStream.first, /"manageDevices":false/);
});

test('a device that cannot be saved is never handed out, and a revoke that cannot be saved is reported', async () => {
  const victim = JSON.parse((await pcCall('POST', '/api/devices', { name: 'victim 2' })).body) as { id: string; token: string };
  const call = await signInDevice(victim.token);
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
    assert.equal((await get('/api/state', { Cookie: call })).status, 401, 'the session still ended');
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
  const entries = text.trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
  const create = entries.find((entry) => entry.action === 'device-create' && entry.id === made.id)!;
  assert.deepEqual([create.device, create.deviceId, create.name, create.ok], ['This PC', 'pc', 'audited', true]);
  const revoke = entries.find((entry) => entry.action === 'device-revoke' && entry.id === made.id)!;
  assert.deepEqual([revoke.device, revoke.deviceId, revoke.name, revoke.found, revoke.persisted], ['This PC', 'pc', 'audited', true, true]);
});

test('the device cap answers 409 with a fixed string', async () => {
  const have = (JSON.parse((await pcCall('GET', '/api/devices')).body).devices as unknown[]).length;
  for (let i = have; i < 100; i++) devices.create(`filler ${i}`);
  const response = await pcCall('POST', '/api/devices', { name: 'one too many' });
  assert.equal(response.status, 409);
  assert.deepEqual(JSON.parse(response.body), { error: 'at most 100 devices' });
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
  assert.deepEqual(after.map((item) => item.id), ['signin:127.0.0.1']);
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
