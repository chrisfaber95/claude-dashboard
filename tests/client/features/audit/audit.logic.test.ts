// Audit log labels, rows and the device filter query.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AuditEntry } from '../../../../src/shared/types/index.ts';
import { actionLabel, auditQuery, mergeDeviceOptions, rowOf, timeLabel } from '../../../../src/client/features/audit/audit.logic.ts';

const entry = (overrides: Partial<AuditEntry>): AuditEntry => ({ ts: '2026-10-09T10:00:00.000Z', action: 'start', ...overrides });

test('timeLabel is the local date and time, zero padded; junk is shown as it is', () => {
  const local = new Date(2026, 0, 5, 3, 4, 9);
  assert.equal(timeLabel(local.toISOString()), '2026-01-05 03:04:09');
  assert.equal(timeLabel('not a time'), 'not a time');
});

test('actionLabel names the known actions and passes unknown ones through', () => {
  assert.equal(actionLabel('start'), 'Started a task');
  assert.equal(actionLabel('device-revoke'), 'Revoked a device');
  assert.equal(actionLabel('something-new'), 'something-new');
});

test('rowOf formats an entry: device name, project or short session, result, prompt', () => {
  assert.deepEqual(rowOf(entry({ device: 'Kitchen phone', deviceId: 'aaaaaaaaaaaa', project: 'Alpha', ok: true, prompt: 'hello' })), {
    time: timeLabel('2026-10-09T10:00:00.000Z'),
    device: 'Kitchen phone',
    action: 'Started a task',
    target: 'Alpha',
    result: 'ok',
    prompt: 'hello',
  });
  const stop = rowOf(entry({ action: 'stop', deviceId: 'pc', session: '0123456789abcdef', ok: false }));
  assert.deepEqual([stop.device, stop.target, stop.result, stop.prompt], ['pc', '01234567', 'failed', ''], 'falls back to the id and a short session');
  const bare = rowOf(entry({}));
  assert.deepEqual([bare.device, bare.target, bare.result], ['unknown', '', ''], 'old entries without device or result');
});

test('rowOf keeps user text as plain strings: no markup is interpreted or removed here', () => {
  const row = rowOf(entry({ device: '<b>x</b>', prompt: '<img src=x onerror=alert(1)>', project: '"quoted"' }));
  assert.equal(row.device, '<b>x</b>');
  assert.equal(row.prompt, '<img src=x onerror=alert(1)>');
  assert.equal(row.target, '"quoted"', 'escaping is the renderer job (esc())');
});

test('mergeDeviceOptions lists each device once by name, sorted, and remembers earlier choices', () => {
  const first = mergeDeviceOptions(
    [],
    [entry({ device: 'Phone', deviceId: 'bbbbbbbbbbbb' }), entry({ device: 'This PC', deviceId: 'pc' }), entry({ device: 'Phone', deviceId: 'bbbbbbbbbbbb' }), entry({ ts: 'x', action: 'old' })],
  );
  assert.deepEqual(first, [
    { id: 'bbbbbbbbbbbb', name: 'Phone' },
    { id: 'pc', name: 'This PC' },
  ]);
  // after filtering to one device the list of choices must not shrink
  const filtered = mergeDeviceOptions(first, [entry({ device: 'Phone', deviceId: 'bbbbbbbbbbbb' })]);
  assert.deepEqual(filtered, first);
  // a new device appears; the newest name wins for a renamed one
  const more = mergeDeviceOptions(first, [entry({ device: 'Tablet', deviceId: 'cccccccccccc' }), entry({ device: 'Phone 2', deviceId: 'bbbbbbbbbbbb' }), entry({ device: 'Phone', deviceId: 'bbbbbbbbbbbb' })]);
  assert.deepEqual(more, [
    { id: 'bbbbbbbbbbbb', name: 'Phone 2' },
    { id: 'cccccccccccc', name: 'Tablet' },
    { id: 'pc', name: 'This PC' },
  ]);
  assert.deepEqual(mergeDeviceOptions([], []), []);
  assert.deepEqual(mergeDeviceOptions([], [entry({ deviceId: 'aaaaaaaaaaaa' })]), [{ id: 'aaaaaaaaaaaa', name: 'aaaaaaaaaaaa' }], 'an id without a name is shown by id');
});

test('mergeDeviceOptions does not offer an id the server could not filter on', () => {
  const out = mergeDeviceOptions([], [entry({ device: 'Odd', deviceId: 'a b' }), entry({ device: 'Dots', deviceId: 'x.y' }), entry({ device: 'Fine', deviceId: 'aaaaaaaaaaaa' })]);
  assert.deepEqual(out, [{ id: 'aaaaaaaaaaaa', name: 'Fine' }]);
});

test('auditQuery only builds a query for a plain device id', () => {
  assert.equal(auditQuery(''), '');
  assert.equal(auditQuery('pc'), '?device=pc');
  assert.equal(auditQuery('0123456789ab'), '?device=0123456789ab');
  for (const bad of ['a b', 'a&b=1', '../x', 'x'.repeat(65), 'é']) assert.equal(auditQuery(bad), '', bad);
});
