// Device list labels, sorting and name validation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DeviceInfo } from '../../../../src/shared/types/index.ts';
import { cleanName, createdLabel, lastSeenLabel, sortDevices } from '../../../../src/client/features/devices/devices.logic.ts';

const makeDevice = (id: string, name: string, createdMs: number): DeviceInfo => ({ id, name, createdMs, lastSeenMs: null });

test('lastSeenLabel says never, then coarse relative times', () => {
  const now = 10_000_000_000;
  assert.equal(lastSeenLabel(null, now), 'never');
  assert.equal(lastSeenLabel(now - 5_000, now), 'just now');
  assert.equal(lastSeenLabel(now + 5_000, now), 'just now', 'a clock a little ahead is not negative');
  assert.equal(lastSeenLabel(now - 59_000, now), 'just now');
  assert.equal(lastSeenLabel(now - 60_000, now), '1m ago');
  assert.equal(lastSeenLabel(now - 59 * 60_000, now), '59m ago');
  assert.equal(lastSeenLabel(now - 3_600_000, now), '1h ago');
  assert.equal(lastSeenLabel(now - 23 * 3_600_000, now), '23h ago');
  assert.equal(lastSeenLabel(now - 86_400_000, now), '1d ago');
  assert.equal(lastSeenLabel(now - 9 * 86_400_000, now), '9d ago');
});

test('createdLabel is the local calendar date, zero padded', () => {
  assert.equal(createdLabel(new Date(2026, 0, 5, 13, 30).getTime()), '2026-01-05');
  assert.equal(createdLabel(new Date(2026, 11, 31, 23, 59).getTime()), '2026-12-31');
});

test('sortDevices puts the newest first, breaks ties by name then id, and does not mutate', () => {
  const input = [makeDevice('3', 'b', 100), makeDevice('1', 'a', 100), makeDevice('2', 'z', 300), makeDevice('4', 'a', 100)];
  const copy = [...input];
  assert.deepEqual(sortDevices(input).map((device) => device.id), ['2', '1', '4', '3']);
  assert.deepEqual(input, copy);
  assert.deepEqual(sortDevices([]), []);
});

test('cleanName trims and enforces 1-40 characters like the server', () => {
  assert.equal(cleanName('  Phone  '), 'Phone');
  assert.equal(cleanName('x'.repeat(40)), 'x'.repeat(40));
  assert.equal(cleanName('x'.repeat(41)), null);
  assert.equal(cleanName(''), null);
  assert.equal(cleanName('   '), null);
});
