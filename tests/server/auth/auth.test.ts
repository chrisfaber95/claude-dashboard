// Login, cookie sessions, rate limiting, revocation and the loopback exemption.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { PC_DEVICE, isLoopbackRequest, readCookie } from '../../../src/server/auth/auth.ts';
import { fx, DAY, count, reqWith, sidFrom, setup } from './auth-test-setup.ts';

test('login accepts only a device token and issues an authenticating cookie bound to that device', () => {
  const { auth, id, token } = setup();
  assert.equal(auth.login('1.1.1.1', 'wrong'), null);
  assert.equal(auth.login('1.1.1.1', token + 'x'), null);
  const sessionId = auth.login('1.1.1.1', ` ${token}\n`);
  assert.equal(typeof sessionId, 'string');
  const cookie = auth.cookie(sessionId as string, true);
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
  const { auth, token } = setup(() => now, (ip, timestampMs) => failures.push([ip, timestampMs]));
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

test('a device session slides: each authed request extends it to 7 days, so only revocation, 7 idle days or the 90-day limit ends it', () => {
  let now = 0;
  const { auth, token } = setup(() => now);
  const sessionId = auth.login('4.4.4.4', token) as string;
  const req = reqWith(`dash_sid=${sessionId}`);
  for (let i = 1; i <= 14; i++) {
    now = i * 6 * DAY; // active every 6 days for 84 days
    assert.ok(auth.identify(req), `day ${i * 6}`);
  }
  now += 7 * DAY + 1; // idle for more than 7 days
  assert.equal(auth.identify(req), null);
});

test('the cookie is re-issued at most once a day', () => {
  let now = 0;
  const { auth, token } = setup(() => now);
  const sessionId = auth.login('4.4.4.4', token) as string;
  const req = reqWith(`dash_sid=${sessionId}`);
  assert.equal(auth.identify(req)?.refreshSid, null);
  now = DAY - 1;
  assert.equal(auth.identify(req)?.refreshSid, null);
  now = DAY;
  assert.equal(auth.identify(req)?.refreshSid, sessionId);
  now = DAY + 1000;
  assert.equal(auth.identify(req)?.refreshSid, null);
  now = 2 * DAY;
  assert.equal(auth.identify(req)?.refreshSid, sessionId);
});

test('identify records the device as seen', () => {
  let now = 5000;
  const { auth, devices, token } = setup(() => now);
  const sessionId = auth.login('4.4.4.4', token) as string;
  now = 9000;
  auth.identify(reqWith(`dash_sid=${sessionId}`));
  assert.equal(devices.list()[0].lastSeenMs, 9000);
});

test('logout ends the session', () => {
  const { auth, token } = setup();
  const sessionId = auth.login('4.4.4.4', token) as string;
  const req = reqWith(`dash_sid=${sessionId}`);
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
  auth.onRevoke((deviceId) => revoked.push(deviceId));
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
  const sessionId = auth.login('1.1.1.1', token) as string;
  devices.revoke(id);
  assert.equal(auth.identify(reqWith(`dash_sid=${sessionId}`)), null);
});

test('loopback socket with a loopback Host is the PC and needs no token', () => {
  const { auth } = setup();
  for (const [addr, host] of [
    ['127.0.0.1', '127.0.0.1:4777'],
    ['::1', 'localhost:4777'],
    ['::ffff:127.0.0.1', '[::1]:4777'],
    ['127.0.0.1', 'LOCALHOST'],
  ]) {
    const request = reqWith(undefined, { addr, host });
    assert.ok(isLoopbackRequest(request), `${addr} ${host}`);
    // Identity.sid is the server field name, kept so the identity shape stays the same.
    // eslint-disable-next-line id-denylist
    assert.deepEqual(auth.identify(request), { deviceId: PC_DEVICE, sid: null, refreshSid: null });
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
    const request = reqWith(undefined, { addr, host });
    assert.ok(!isLoopbackRequest(request), `${addr} ${host}`);
    assert.equal(auth.identify(request), null, `${addr} ${host}`);
  }
});

test('forwarding headers never grant the loopback exemption', () => {
  const { auth } = setup();
  const request = reqWith(undefined, {
    headers: { 'x-forwarded-for': '127.0.0.1', forwarded: 'for=127.0.0.1', 'x-real-ip': '127.0.0.1', 'x-forwarded-host': 'localhost' },
  });
  assert.equal(auth.identify(request), null);
});

test('a proxied request is never exempt, even from a loopback socket with a loopback Host', () => {
  const { auth } = setup();
  for (const header of ['x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'forwarded', 'via']) {
    const request = reqWith(undefined, { addr: '127.0.0.1', host: 'localhost:4777', headers: { [header]: 'anything' } });
    assert.equal(isLoopbackRequest(request), false, header);
    assert.equal(auth.identify(request), null, header);
  }
});

test('readCookie parses multiple cookies and ignores undecodable values', () => {
  assert.equal(readCookie(reqWith('a=1; dash_sid=xyz; b=2'), 'dash_sid'), 'xyz');
  assert.equal(readCookie(reqWith('a=1'), 'dash_sid'), null);
  assert.equal(readCookie(reqWith('dash_sid=%E0%A4%A'), 'dash_sid'), null);
});

test('revokeDevice still ends sessions and notifies listeners when the file write fails, and says so', () => {
  const { auth, devices, id, token } = setup();
  const sessionId = auth.login('1.1.1.1', token) as string;
  const revoked: string[] = [];
  auth.onRevoke((deviceId) => revoked.push(deviceId));
  const dir = `${fx.dataDir}-${count - 1}`;
  rmSync(join(dir, 'devices.json'));
  mkdirSync(join(dir, 'devices.json')); // the rename onto a directory fails
  assert.deepEqual(auth.revokeDevice(id), { found: true, persisted: false });
  assert.deepEqual(revoked, [id]);
  assert.equal(auth.identify(reqWith(`dash_sid=${sessionId}`)), null);
  assert.equal(devices.has(id), false);
});

// ---- QR pairing (T-011) ----
