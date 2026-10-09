import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { PC_DEVICE, createAuth, isLoopbackRequest, readCookie } from '../src/server/auth.ts';
import { createDeviceStore } from '../src/server/devices.ts';
import { makeFixture } from './helpers.ts';

const fx = makeFixture();
const DAY = 86_400_000;
let n = 0;
const reqWith = (cookie?: string, extra: { host?: string; addr?: string; headers?: Record<string, string> } = {}) =>
  ({
    headers: { host: extra.host ?? '192.168.1.50:4777', ...(cookie ? { cookie } : {}), ...extra.headers },
    socket: { remoteAddress: extra.addr ?? '192.168.1.20' },
  }) as unknown as IncomingMessage;
const sidFrom = (setCookie: string) => setCookie.split(';')[0].split('=')[1];

function setup(now: () => number = Date.now, onFailedLogin?: (ip: string, t: number) => void) {
  const devices = createDeviceStore(`${fx.dataDir}-${n++}`, now);
  const auth = createAuth(devices, { now, onFailedLogin });
  const { id, token } = devices.create('phone');
  return { devices, auth, id, token };
}

test('login accepts only a device token and issues an authenticating cookie bound to that device', () => {
  const { auth, id, token } = setup();
  assert.equal(auth.login('1.1.1.1', 'wrong'), null);
  assert.equal(auth.login('1.1.1.1', token + 'x'), null);
  const sid = auth.login('1.1.1.1', ` ${token}\n`);
  assert.equal(typeof sid, 'string');
  const cookie = auth.cookie(sid as string, true);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
  assert.equal(auth.identify(reqWith(`other=1; ${cookie.split(';')[0]}`))?.deviceId, id);
  assert.equal(auth.identify(reqWith('dash_sid=forged')), null);
  assert.equal(auth.identify(reqWith()), null);
});

test('two devices get separate identities', () => {
  const { auth, devices, id, token } = setup();
  const other = devices.create('laptop');
  const s1 = auth.login('1.1.1.1', token) as string;
  const s2 = auth.login('1.1.1.2', other.token) as string;
  assert.equal(auth.identify(reqWith(`dash_sid=${s1}`))?.deviceId, id);
  assert.equal(auth.identify(reqWith(`dash_sid=${s2}`))?.deviceId, other.id);
});

test('login is rate limited per IP for a minute and failures reach the hook', () => {
  let now = 0;
  const failures: Array<[string, number]> = [];
  const { auth, token } = setup(() => now, (ip, t) => failures.push([ip, t]));
  for (let i = 0; i < 5; i++) assert.equal(auth.login('2.2.2.2', 'nope'), null);
  assert.equal(auth.login('2.2.2.2', token), 'rate-limited', 'even the right token is refused while limited');
  assert.equal(failures.length, 6, 'failed and rate-limited sign-ins both reported');
  assert.deepEqual(failures[0], ['2.2.2.2', 0]);
  assert.equal(typeof auth.login('3.3.3.3', token), 'string', 'other IPs are unaffected');
  assert.equal(failures.length, 6, 'success is not reported');
  now = 61_000;
  assert.equal(typeof auth.login('2.2.2.2', token), 'string');
});

test('a throwing failed-login hook does not break sign-in', () => {
  const { auth } = setup(Date.now, () => {
    throw new Error('boom');
  });
  assert.equal(auth.login('5.5.5.5', 'nope'), null);
});

test('a device session slides: each authed request extends it to 7 days, so only revocation or 7 idle days ends it', () => {
  let now = 0;
  const { auth, token } = setup(() => now);
  const sid = auth.login('4.4.4.4', token) as string;
  const req = reqWith(`dash_sid=${sid}`);
  for (let i = 1; i <= 20; i++) {
    now = i * 6 * DAY; // active every 6 days for 120 days
    assert.ok(auth.identify(req), `day ${i * 6}`);
  }
  now += 7 * DAY + 1; // idle for more than 7 days
  assert.equal(auth.identify(req), null);
});

test('the cookie is re-issued at most once a day', () => {
  let now = 0;
  const { auth, token } = setup(() => now);
  const sid = auth.login('4.4.4.4', token) as string;
  const req = reqWith(`dash_sid=${sid}`);
  assert.equal(auth.identify(req)?.refreshSid, null);
  now = DAY - 1;
  assert.equal(auth.identify(req)?.refreshSid, null);
  now = DAY;
  assert.equal(auth.identify(req)?.refreshSid, sid);
  now = DAY + 1000;
  assert.equal(auth.identify(req)?.refreshSid, null);
  now = 2 * DAY;
  assert.equal(auth.identify(req)?.refreshSid, sid);
});

test('identify records the device as seen', () => {
  let now = 5000;
  const { auth, devices, token } = setup(() => now);
  const sid = auth.login('4.4.4.4', token) as string;
  now = 9000;
  auth.identify(reqWith(`dash_sid=${sid}`));
  assert.equal(devices.list()[0].lastSeenMs, 9000);
});

test('logout ends the session', () => {
  const { auth, token } = setup();
  const sid = auth.login('4.4.4.4', token) as string;
  const req = reqWith(`dash_sid=${sid}`);
  auth.logout(req);
  assert.equal(auth.identify(req), null);
  assert.match(auth.clearCookie(false), /Max-Age=0/);
  assert.equal(sidFrom(auth.cookie('abc', false)), 'abc');
});

test("revokeDevice ends that device's sessions at once, keeps the others, and notifies listeners", () => {
  const { auth, devices, id, token } = setup();
  const other = devices.create('laptop');
  const a1 = auth.login('1.1.1.1', token) as string;
  const a2 = auth.login('1.1.1.9', token) as string;
  const b = auth.login('1.1.1.2', other.token) as string;
  const revoked: string[] = [];
  auth.onRevoke((d) => revoked.push(d));
  assert.deepEqual(auth.revokeDevice(id), { found: true, persisted: true });
  assert.deepEqual(revoked, [id]);
  assert.equal(auth.identify(reqWith(`dash_sid=${a1}`)), null);
  assert.equal(auth.identify(reqWith(`dash_sid=${a2}`)), null);
  assert.equal(auth.identify(reqWith(`dash_sid=${b}`))?.deviceId, other.id);
  assert.equal(auth.login('1.1.1.1', token), null, 'the token no longer signs in');
  assert.equal(auth.revokeDevice(id).found, false);
  assert.deepEqual(revoked, [id], 'no notification for an unknown device');
});

test('a session of a device removed straight from the store is refused', () => {
  const { auth, devices, id, token } = setup();
  const sid = auth.login('1.1.1.1', token) as string;
  devices.revoke(id);
  assert.equal(auth.identify(reqWith(`dash_sid=${sid}`)), null);
});

test('loopback socket with a loopback Host is the PC and needs no token', () => {
  const { auth } = setup();
  for (const [addr, host] of [
    ['127.0.0.1', '127.0.0.1:4777'],
    ['::1', 'localhost:4777'],
    ['::ffff:127.0.0.1', '[::1]:4777'],
    ['127.0.0.1', 'LOCALHOST'],
  ]) {
    const r = reqWith(undefined, { addr, host });
    assert.ok(isLoopbackRequest(r), `${addr} ${host}`);
    assert.deepEqual(auth.identify(r), { deviceId: PC_DEVICE, refreshSid: null });
  }
});

test('the loopback exemption needs both: a non-loopback Host on a loopback socket, or a loopback Host from elsewhere, is refused', () => {
  const { auth } = setup();
  for (const [addr, host] of [
    ['127.0.0.1', '192.168.1.50:4777'],
    ['127.0.0.1', 'evil.example'],
    ['127.0.0.1', ''],
    ['127.0.0.1', '127.0.0.1.evil.example'],
    ['192.168.1.20', '127.0.0.1:4777'],
    ['192.168.1.20', 'localhost'],
    ['', 'localhost'],
  ]) {
    const r = reqWith(undefined, { addr, host });
    assert.ok(!isLoopbackRequest(r), `${addr} ${host}`);
    assert.equal(auth.identify(r), null, `${addr} ${host}`);
  }
});

test('forwarding headers never grant the loopback exemption', () => {
  const { auth } = setup();
  const r = reqWith(undefined, {
    headers: { 'x-forwarded-for': '127.0.0.1', forwarded: 'for=127.0.0.1', 'x-real-ip': '127.0.0.1', 'x-forwarded-host': 'localhost' },
  });
  assert.equal(auth.identify(r), null);
});

test('a proxied request is never exempt, even from a loopback socket with a loopback Host', () => {
  const { auth } = setup();
  for (const h of ['x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'forwarded', 'via']) {
    const r = reqWith(undefined, { addr: '127.0.0.1', host: 'localhost:4777', headers: { [h]: 'anything' } });
    assert.equal(isLoopbackRequest(r), false, h);
    assert.equal(auth.identify(r), null, h);
  }
});

test('readCookie parses multiple cookies and ignores undecodable values', () => {
  assert.equal(readCookie(reqWith('a=1; dash_sid=xyz; b=2'), 'dash_sid'), 'xyz');
  assert.equal(readCookie(reqWith('a=1'), 'dash_sid'), null);
  assert.equal(readCookie(reqWith('dash_sid=%E0%A4%A'), 'dash_sid'), null);
});

test('revokeDevice still ends sessions and notifies listeners when the file write fails, and says so', () => {
  const { auth, devices, id, token } = setup();
  const sid = auth.login('1.1.1.1', token) as string;
  const revoked: string[] = [];
  auth.onRevoke((d) => revoked.push(d));
  const dir = `${fx.dataDir}-${n - 1}`;
  rmSync(join(dir, 'devices.json'));
  mkdirSync(join(dir, 'devices.json')); // the rename onto a directory fails
  assert.deepEqual(auth.revokeDevice(id), { found: true, persisted: false });
  assert.deepEqual(revoked, [id]);
  assert.equal(auth.identify(reqWith(`dash_sid=${sid}`)), null);
  assert.equal(devices.has(id), false);
});

// ---- QR pairing (T-011) ----

const MIN = 60_000;

test('a pairing code signs in as its device, once', () => {
  const { auth, id } = setup();
  const p = auth.createPairing(id)!;
  assert.ok(p.code.length >= 40);
  const sid = auth.pair('5.5.5.5', p.code);
  assert.equal(typeof sid, 'string');
  assert.equal(auth.identify(reqWith(`dash_sid=${sid}`))?.deviceId, id);
  assert.equal(auth.pair('5.5.5.5', p.code), null, 'a second use fails');
});

test('a pairing code is not the device token and an unknown device gets none', () => {
  const { auth, id, token } = setup();
  const p = auth.createPairing(id)!;
  assert.notEqual(p.code, token);
  assert.equal(auth.pair('5.5.5.5', token), null, 'the token is not a pairing code');
  assert.equal(auth.createPairing('nope'), null);
  assert.equal(auth.createPairing('pc'), null, 'pc is not a device');
});

test('a pairing code expires after 10 minutes, and a late try still spends it', () => {
  let now = 1000;
  const { auth, id } = setup(() => now);
  const ok = auth.createPairing(id)!;
  assert.equal(ok.expiresMs, 1000 + 10 * MIN);
  now = 1000 + 10 * MIN - 1;
  assert.equal(typeof auth.pair('6.6.6.6', ok.code), 'string', 'still valid just before the deadline');

  now = 50 * MIN;
  const late = auth.createPairing(id)!;
  now += 10 * MIN + 1;
  assert.equal(auth.pair('6.6.6.6', late.code), null, 'expired');
  now = late.expiresMs - 1;
  assert.equal(auth.pair('6.6.6.6', late.code), null, 'and gone for good');
});

test('only the newest pairing code of a device works', () => {
  const { auth, id } = setup();
  const first = auth.createPairing(id)!;
  const second = auth.createPairing(id)!;
  assert.equal(auth.pair('7.7.7.7', first.code), null);
  assert.equal(typeof auth.pair('7.7.7.7', second.code), 'string');
});

test('revoking a device invalidates its unused pairing codes but not other devices', () => {
  const { auth, devices, id } = setup();
  const other = devices.create('laptop');
  const mine = auth.createPairing(id)!;
  const theirs = auth.createPairing(other.id)!;
  auth.revokeDevice(id);
  assert.equal(auth.pair('8.8.8.8', mine.code), null);
  assert.equal(typeof auth.pair('8.8.8.8', theirs.code), 'string');
});

test('a code whose device vanished from the store is refused', () => {
  const { auth, devices, id } = setup();
  const p = auth.createPairing(id)!;
  devices.revoke(id);
  assert.equal(auth.pair('8.8.4.4', p.code), null);
});

test('bad pairing codes use the login rate limit and the failed-sign-in hook, and a good one clears it', () => {
  let now = 0;
  const failures: Array<[string, number]> = [];
  const { auth, id, token } = setup(() => now, (ip, t) => failures.push([ip, t]));
  for (const bad of ['', 'nope', 'x'.repeat(500), 'A'.repeat(43)]) assert.equal(auth.pair('9.9.9.9', bad), null);
  assert.equal(failures.length, 4);
  assert.deepEqual(failures[0], ['9.9.9.9', 0]);
  // a wrong token and a wrong code share the same 5-per-minute budget
  assert.equal(auth.login('9.9.9.9', 'wrong'), null);
  const p = auth.createPairing(id)!;
  assert.equal(auth.pair('9.9.9.9', p.code), 'rate-limited', 'even a good code is refused while limited');
  assert.equal(auth.login('9.9.9.9', token), 'rate-limited');
  assert.equal(failures.length, 7, 'rate-limited tries are reported too');
  now = 61_000;
  assert.equal(typeof auth.pair('9.9.9.9', p.code), 'string', 'the code was not spent by the refused try');
  assert.equal(failures.length, 7, 'success is not reported');
});

test('unused codes are capped so memory cannot grow without bound', () => {
  const { auth, devices } = setup();
  const ids = Array.from({ length: 5 }, (_, i) => devices.create(`d${i}`).id);
  const codes = [];
  for (let i = 0; i < 260; i++) codes.push(auth.createPairing(ids[i % ids.length])!);
  // only the newest code of each device ever works, so at most one per device is live
  const live = codes.filter((c, i) => typeof auth.pair(`10.0.${Math.floor(i / 250)}.${i % 250}`, c.code) === 'string');
  assert.equal(live.length, 5);
});
