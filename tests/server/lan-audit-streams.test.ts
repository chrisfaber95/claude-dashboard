// The audit log by device, and live streams ending with their session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { raw } from '../helpers.ts';
import { fx, devices, deviceId, clock, host, get, post, openStream, pcHost, pcCall, deviceCall, signInDevice, newDevice, pairOf } from './lan-test-setup.ts';

type AuditRow = { ts: string; action: string; device?: string; deviceId?: string; project?: string; mode?: string; ok?: boolean; prompt?: string; goal?: string };
const auditOf = async (query = '') => JSON.parse((await pcCall('GET', '/api/audit' + query)).body).entries as AuditRow[];

test('every logged action names the device (name and id); the PC is "This PC" / pc', async () => {
  const phone = await newDevice('Kitchen phone');
  const call = await signInDevice(phone.token);
  const started = await deviceCall(call, 'POST', '/api/commands', { project: 'Alpha', prompt: 'hello from the phone', permissionMode: 'plan' });
  assert.equal(started.status, 200, started.body);
  const made = await newDevice('audit target');
  await pcCall('POST', '/api/devices/revoke', { id: made.id });
  await pairOf((await newDevice('audit pair')).id);

  const entries = await auditOf();
  const start = entries.find((entry) => entry.action === 'start' && entry.deviceId === phone.id)!;
  assert.deepEqual([start.device, start.deviceId, start.project, start.mode, start.ok, start.goal], ['Kitchen phone', phone.id, 'Alpha', 'plan', true, 'hello from the phone']);
  for (const action of ['device-create', 'device-revoke', 'device-pair']) {
    const entry = entries.find((currentEntry) => currentEntry.action === action)!;
    assert.deepEqual([entry.device, entry.deviceId], ['This PC', 'pc'], action);
  }
  // every line the server wrote after this change names a device
  const raw = readFileSync(join(fx.dataDir, 'commands.log'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.ok(raw.length >= 4);
  for (const eachEntry of raw) assert.ok(typeof eachEntry.device === 'string' && typeof eachEntry.deviceId === 'string', JSON.stringify(eachEntry));
});

test('GET /api/audit: any signed-in device may read it, newest first, filtered by device id, allowlisted fields only', async () => {
  const phone = await newDevice('Reader');
  const call = await signInDevice(phone.token);
  const asDevice = await deviceCall(call, 'GET', '/api/audit');
  assert.equal(asDevice.status, 200, 'a LAN device may read the log');
  assert.deepEqual(Object.keys(JSON.parse(asDevice.body)), ['entries']);
  const all = JSON.parse(asDevice.body).entries as AuditRow[];
  assert.ok(all.length >= 4);
  const times = all.map((entry) => Date.parse(entry.ts));
  assert.deepEqual(times, [...times].sort((a, b) => b - a), 'newest first');

  const onlyPc = await auditOf('?device=pc');
  assert.ok(onlyPc.length > 0 && onlyPc.every((entry) => entry.deviceId === 'pc'));
  const onlyPhone = JSON.parse((await deviceCall(call, 'GET', '/api/audit?device=' + (await (async () => (JSON.parse((await pcCall('GET', '/api/devices')).body).devices as Array<{ id: string; name: string }>).find((device) => device.name === 'Kitchen phone')!.id)()))).body).entries as AuditRow[];
  assert.ok(onlyPhone.length >= 1 && onlyPhone.every((entry) => entry.device === 'Kitchen phone'));
  assert.deepEqual(await auditOf('?device=ffffffffffff'), []);

  // nothing but the allowlisted fields: no ip, no target ids/names, no codes
  const allowed = new Set(['ts', 'action', 'device', 'deviceId', 'project', 'session', 'mode', 'ok', 'prompt', 'goal', 'notesLength']);
  for (const currentEntry of all) for (const key of Object.keys(currentEntry)) assert.ok(allowed.has(key), key);
  assert.ok(!asDevice.body.includes('127.0.0.1') && !asDevice.body.includes('pair?c='));
});

test('GET /api/audit keeps every request check and answers with fixed strings', async () => {
  assert.equal((await get('/api/audit')).status, 401, 'login required');
  assert.equal((await pcCall('GET', '/api/audit', undefined, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  for (const bad of ['?device=', '?device=a%20b', '?device=' + 'x'.repeat(65), '?device=..%2f..%2fsecret', '?device=a;b']) {
    const response = await pcCall('GET', '/api/audit' + bad);
    assert.equal(response.status, 400, bad);
    assert.deepEqual(JSON.parse(response.body), { error: 'invalid device filter' });
  }
  assert.equal((await pcCall('POST', '/api/audit', {})).status, 404, 'read-only');
  // an unreadable log: a fixed message, no path or error text
  const log = join(fx.dataDir, 'commands.log');
  const saved = readFileSync(log);
  rmSync(log);
  mkdirSync(log);
  try {
    const response = await pcCall('GET', '/api/audit');
    assert.equal(response.status, 500);
    assert.deepEqual(JSON.parse(response.body), { error: 'could not read the audit log' });
  } finally {
    rmSync(log, { recursive: true, force: true });
    writeFileSync(log, saved);
  }
});

// ---- session hardening (T-015): streams end with their session ----

const settledWithin = (path: Promise<void>, ms: number) => Promise.race([path.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms))]);

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
  for (const cValue of rest) assert.equal((await get('/api/state', { Cookie: cValue })).status, 200);
});

test('a session that runs out closes its stream within a tick, while the PC stream stays', async () => {
  const dev = await newDevice('expiry streams');
  const call = await signInDevice(dev.token);
  const session = await openStream({ Host: host, Cookie: call });
  const pc = await openStream({ Host: pcHost() });
  assert.equal(session.status, 200);
  clock.skew = 8 * 86_400_000; // 8 days pass without a request
  try {
    assert.equal(await settledWithin(session.ended, 5000), true, 'closed by the next 2 s tick, no request needed');
    assert.equal(await settledWithin(pc.ended, 100), false);
    assert.equal((await get('/api/state', { Cookie: call })).status, 401);
  } finally {
    clock.skew = 0;
  }
});
