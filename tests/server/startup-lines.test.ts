import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startupLines } from '../../src/server/server.ts';

test('localhost mode prints one plain http line', () => {
  assert.deepEqual(startupLines(false, '127.0.0.1', 4777, ['192.168.1.5']), ['Claude dashboard on http://127.0.0.1:4777']);
});

test('LAN mode lists this PC first, then the LAN addresses for other devices', () => {
  const lines = startupLines(true, '0.0.0.0', 4777, ['192.168.1.5', '10.0.0.2']);
  assert.deepEqual(lines, [
    'Claude dashboard, this PC (no login): https://localhost:4777',
    'Claude dashboard, other devices (sign in with a device token): https://192.168.1.5:4777',
    'Claude dashboard, other devices (sign in with a device token): https://10.0.0.2:4777',
  ]);
});

test('LAN mode bound to one host lists that host for other devices', () => {
  const lines = startupLines(true, '192.168.1.5', 4777, ['10.0.0.2']);
  assert.equal(lines.length, 2);
  assert.match(lines[1], /https:\/\/192\.168\.1\.5:4777$/);
});
