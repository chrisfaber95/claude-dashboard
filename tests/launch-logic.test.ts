import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AuditEntry } from '../src/shared/types.ts';
import { timeLabel } from '../src/client/audit-logic.ts';
import { fieldsAfterLaunch, launchBody, launchRow, launchState, truncate } from '../src/client/launch-logic.ts';

const e = (o: Partial<AuditEntry>): AuditEntry => ({ ts: '2026-10-09T10:00:00.000Z', action: 'start', ...o });

test('launchBody trims goal and notes and keeps the permissionMode key', () => {
  assert.deepEqual(launchBody('Alpha', '  fix it \n', '\n notes ', 'plan'), { project: 'Alpha', goal: 'fix it', notes: 'notes', permissionMode: 'plan' });
  assert.equal(launchBody('Alpha', '   ', '', 'plan').goal, '');
});

test('fields are cleared after success and kept after failure', () => {
  assert.deepEqual(fieldsAfterLaunch(true), { clearGoal: true, clearNotes: true });
  assert.deepEqual(fieldsAfterLaunch(false), { clearGoal: false, clearNotes: false });
});

test('truncate collapses whitespace and cuts with an ellipsis', () => {
  assert.equal(truncate('a  b\n c', 10), 'a b c');
  assert.equal(truncate('abcdefghij', 5), 'abcd…');
  assert.equal(truncate('abcde', 5), 'abcde');
});

test('launchRow formats time, project, goal, device and session', () => {
  const row = launchRow(e({ device: 'Phone', deviceId: 'x', project: 'Alpha', goal: 'do it', session: 'abcd1234', ok: true }));
  assert.equal(row.time, timeLabel('2026-10-09T10:00:00.000Z'));
  assert.equal(row.project, 'Alpha');
  assert.equal(row.goal, 'do it');
  assert.equal(row.device, 'Phone');
  assert.equal(row.session, 'abcd1234');
  assert.equal(row.ok, true);
});

test('launchRow falls back to the device id, the prompt, and drops the session of a failed start', () => {
  const row = launchRow(e({ deviceId: 'pc', prompt: 'old', session: 'abcd1234', ok: false }));
  assert.equal(row.device, 'pc');
  assert.equal(row.goal, 'old');
  assert.equal(row.session, '');
  assert.equal(row.ok, false);
  assert.equal(launchRow(e({})).device, 'unknown');
});

test('launchState: running only for a successful launch with a live session', () => {
  assert.equal(launchState({ ok: true, session: 'abcd' }, true), 'running');
  assert.equal(launchState({ ok: true, session: 'abcd' }, false), 'not live');
  assert.equal(launchState({ ok: true, session: '' }, true), 'not live');
  assert.equal(launchState({ ok: false, session: '' }, true), 'failed');
});
