// Pairing codes, the 90-day session limit, the per-device session cap and end-of-session events.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { DAY, reqWith, setup } from './auth-test-setup.ts';

const MIN = 60_000;

test('a pairing code signs in as its device, once', () => {
  const { auth, id } = setup();
  const path = auth.createPairing(id)!;
  assert.ok(path.code.length >= 40);
  const sessionId = auth.pair('5.5.5.5', path.code);
  assert.equal(typeof sessionId, 'string');
  assert.equal(auth.identify(reqWith(`dash_sid=${sessionId}`))?.deviceId, id);
  assert.equal(auth.pair('5.5.5.5', path.code), null, 'a second use fails');
});

test('peeking at a pairing code changes nothing: not spent, not counted', () => {
  let nowMs = 1_000_000;
  const { auth, id } = setup(() => nowMs);
  const path = auth.createPairing(id)!;
  for (let i = 0; i < 20; i++) assert.equal(auth.peekPairing(path.code), 'phone');
  assert.equal(auth.peekPairing('nope'), null);
  assert.equal(auth.peekPairing('x'.repeat(500)), null);
  assert.equal(typeof auth.pair('5.5.5.5', path.code), 'string', 'still valid, and the peeks used no attempts');
  assert.equal(auth.peekPairing(path.code), null, 'gone once spent');
  const late = auth.createPairing(id)!;
  nowMs += 10 * MIN + 1;
  assert.equal(auth.peekPairing(late.code), null, 'expired');
});

test('a pairing code is not the device token and an unknown device gets none', () => {
  const { auth, id, token } = setup();
  const path = auth.createPairing(id)!;
  assert.notEqual(path.code, token);
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
  const path = auth.createPairing(id)!;
  devices.revoke(id);
  assert.equal(auth.pair('8.8.4.4', path.code), null);
});

test('bad pairing codes use the login rate limit and the failed-sign-in hook, and a good one clears it', () => {
  let now = 0;
  const failures: Array<[string, number]> = [];
  const { auth, id, token } = setup(() => now, (ip, timestampMs) => failures.push([ip, timestampMs]));
  for (const bad of ['', 'nope', 'x'.repeat(500), 'A'.repeat(43)]) assert.equal(auth.pair('9.9.9.9', bad), null);
  assert.equal(failures.length, 4);
  assert.deepEqual(failures[0], ['9.9.9.9', 0]);
  // a wrong token and a wrong code share the same 5-per-minute budget
  assert.equal(auth.login('9.9.9.9', 'wrong'), null);
  const path = auth.createPairing(id)!;
  assert.equal(auth.pair('9.9.9.9', path.code), 'rate-limited', 'even a good code is refused while limited');
  assert.equal(auth.login('9.9.9.9', token), 'rate-limited');
  assert.equal(failures.length, 7, 'rate-limited tries are reported too');
  now = 61_000;
  assert.equal(typeof auth.pair('9.9.9.9', path.code), 'string', 'the code was not spent by the refused try');
  assert.equal(failures.length, 7, 'success is not reported');
});

test('unused codes are capped so memory cannot grow without bound', () => {
  const { auth, devices } = setup();
  const ids = Array.from({ length: 5 }, (_, i) => devices.create(`d${i}`).id);
  const codes = [];
  for (let i = 0; i < 260; i++) codes.push(auth.createPairing(ids[i % ids.length])!);
  // only the newest code of each device ever works, so at most one per device is live
  const live = codes.filter((pairing, i) => typeof auth.pair(`10.0.${Math.floor(i / 250)}.${i % 250}`, pairing.code) === 'string');
  assert.equal(live.length, 5);
});

// ---- session hardening (T-015) ----

const ended = (auth: ReturnType<typeof setup>['auth']) => {
  const list: string[] = [];
  auth.onSessionEnd((sessionId) => list.push(sessionId));
  return list;
};

test('a session ends 90 days after sign-in even while in use; the 7-day slide never goes past it', () => {
  let now = 0;
  const { auth, token } = setup(() => now);
  const sessionId = auth.login('4.4.4.4', token) as string;
  const list = ended(auth);
  const req = reqWith(`dash_sid=${sessionId}`);
  for (let day = 5; day <= 85; day += 5) {
    now = day * DAY; // used every 5 days
    assert.ok(auth.identify(req), `day ${day}`);
  }
  now = 89 * DAY;
  assert.ok(auth.identify(req), 'still valid just before the limit');
  now = 90 * DAY + 1;
  assert.equal(auth.identify(req), null, 'ended by the absolute limit although it was used the day before');
  assert.deepEqual(list, [sessionId]);
  now = 91 * DAY;
  assert.equal(auth.identify(req), null, 'and it does not come back');
});

test('the absolute limit counts from sign-in, not from the last use, and each sign-in has its own clock', () => {
  let now = 0;
  const { auth, token } = setup(() => now);
  const first = auth.login('4.4.4.4', token) as string;
  let second = '';
  for (let day = 5; day <= 85; day += 5) {
    now = day * DAY; // both are used every 5 days
    if (day === 60) second = auth.login('4.4.4.5', token) as string;
    assert.ok(auth.identify(reqWith(`dash_sid=${first}`)), `first, day ${day}`);
    if (second) assert.ok(auth.identify(reqWith(`dash_sid=${second}`)), `second, day ${day}`);
  }
  now = 92 * DAY;
  assert.ok(auth.identify(reqWith(`dash_sid=${second}`)), "signed in on day 60, so it lives until day 150");
  assert.equal(auth.identify(reqWith(`dash_sid=${first}`)), null, "signed in on day 0: over, although it was used on day 85");
});

test('a device has at most 10 sessions: the 11th sign-in ends the oldest, other devices are unaffected', () => {
  const { auth, devices, token } = setup();
  const other = devices.create('laptop');
  const otherSid = auth.login('2.2.2.2', other.token) as string;
  const list = ended(auth);
  const sids: string[] = [];
  for (let i = 0; i < 10; i++) sids.push(auth.login(`3.3.3.${i}`, token) as string);
  assert.deepEqual(list, [], 'ten are fine');
  for (const sessionId of sids) assert.ok(auth.identify(reqWith(`dash_sid=${sessionId}`)));
  const eleventh = auth.login('3.3.3.99', token) as string;
  assert.deepEqual(list, [sids[0]], 'the oldest ended, nothing else');
  assert.equal(auth.identify(reqWith(`dash_sid=${sids[0]}`)), null);
  for (const store of [...sids.slice(1), eleventh]) assert.ok(auth.identify(reqWith(`dash_sid=${store}`)));
  const twelfth = auth.login('3.3.3.98', token) as string;
  assert.deepEqual(list, [sids[0], sids[1]]);
  assert.ok(auth.identify(reqWith(`dash_sid=${twelfth}`)));
  assert.ok(auth.identify(reqWith(`dash_sid=${otherSid}`)), 'the other device keeps its session');
});

test('pairing counts toward the per-device session cap too', () => {
  const { auth, id, token } = setup();
  const first = auth.login('1.0.0.1', token) as string;
  for (let i = 0; i < 10; i++) assert.equal(typeof auth.pair(`1.0.1.${i}`, auth.createPairing(id)!.code), 'string');
  assert.equal(auth.identify(reqWith(`dash_sid=${first}`)), null, 'the token session was the oldest of eleven');
});

test('onSessionEnd fires for logout, revoke, expiry on sweep, expiry on use, and not twice', () => {
  let now = 0;
  const { auth, devices, token } = setup(() => now);
  const list = ended(auth);

  const a = auth.login('5.0.0.1', token) as string;
  auth.logout(reqWith(`dash_sid=${a}`));
  auth.logout(reqWith(`dash_sid=${a}`));
  assert.deepEqual(list, [a], 'logout ends it once');

  const other = devices.create('tablet');
  const b = auth.login('5.0.0.2', other.token) as string;
  auth.revokeDevice(other.id);
  assert.deepEqual(list, [a, b], 'revoke ends the sessions of that device');

  const sessionId = auth.login('5.0.0.3', token) as string;
  now = 6 * DAY;
  auth.sweepExpired();
  assert.deepEqual(list, [a, b], 'not expired yet');
  now = 7 * DAY + 1;
  auth.sweepExpired();
  assert.deepEqual(list, [a, b, sessionId], 'a sweep ends the sessions that ran out');
  auth.sweepExpired();
  assert.equal(list.length, 3);

  const currentSessionId = auth.login('5.0.0.4', token) as string;
  now += 8 * DAY;
  assert.equal(auth.identify(reqWith(`dash_sid=${currentSessionId}`)), null);
  assert.deepEqual(list.slice(3), [currentSessionId], 'noticing the expiry on use ends it once');
});

test('a throwing end listener does not stop the others or break logout', () => {
  const { auth, token } = setup();
  const seen: string[] = [];
  auth.onSessionEnd(() => {
    throw new Error('boom');
  });
  auth.onSessionEnd((sessionId) => seen.push(sessionId));
  const currentSessionId = auth.login('6.0.0.1', token) as string;
  auth.logout(reqWith(`dash_sid=${currentSessionId}`));
  assert.deepEqual(seen, [currentSessionId]);
  assert.equal(auth.identify(reqWith(`dash_sid=${currentSessionId}`)), null);
});

test('identify tells the caller which session a request came in with', () => {
  const { auth, token } = setup();
  const sessionId = auth.login('7.0.0.1', token) as string;
  assert.equal(auth.identify(reqWith(`dash_sid=${sessionId}`))?.sid, sessionId);
});

test('a sweep also ends the sessions of a device that vanished from the store, and a throwing revoke listener is contained', () => {
  const { auth, devices, id, token } = setup();
  const list = ended(auth);
  const sessionId = auth.login('8.0.0.1', token) as string;
  devices.revoke(id); // removed behind the back of revokeDevice
  auth.sweepExpired();
  assert.deepEqual(list, [sessionId]);

  const second = devices.create('tablet');
  const sid2 = auth.login('8.0.0.2', second.token) as string;
  const calls: string[] = [];
  auth.onRevoke(() => { throw new Error('boom'); });
  auth.onRevoke((deviceId) => calls.push(deviceId));
  assert.deepEqual(auth.revokeDevice(second.id), { found: true, persisted: true });
  assert.deepEqual(calls, [second.id], "later listeners still run");
  assert.equal(auth.identify(reqWith(`dash_sid=${sid2}`)), null);
});

test('isLocalPeer: all of 127.0.0.0/8, own interface addresses and a missing peer are local; a LAN phone is not', async () => {
  const { isLocalPeer } = await import('../../../src/server/auth/loopback.ts');
  const { networkInterfaces } = await import('node:os');
  const peer = (addr?: string) => ({ headers: {}, socket: { remoteAddress: addr } }) as unknown as IncomingMessage;
  for (const addr of ['127.0.0.1', '127.0.0.2', '::1', '::ffff:127.0.0.1', '::ffff:127.9.9.9', undefined]) {
    assert.equal(isLocalPeer(peer(addr)), true, String(addr));
  }
  const own = Object.values(networkInterfaces()).flat().find((entry) => entry?.family === 'IPv4' && !entry.internal)?.address;
  if (own) {
    assert.equal(isLocalPeer(peer(own)), true, 'own LAN address');
    assert.equal(isLocalPeer(peer(`::ffff:${own}`)), true, 'mapped own LAN address');
  }
  assert.equal(isLocalPeer(peer('203.0.113.7')), false);
  assert.equal(isLocalPeer(peer('::ffff:203.0.113.7')), false);
  assert.equal(isLocalPeer(peer('1270.0.0.1')), false);
});
