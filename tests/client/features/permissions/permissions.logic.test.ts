// Permission prompt logic: pending filter, who may answer, fixed error messages and approval rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AuditEntry, PermissionRequestInfo } from '../../../../src/shared/types/index.ts';
import {
  PC_HINT,
  answerErrorMessage,
  approvalEntriesOf,
  approvalRowOf,
  canAnswer,
  pendingRequests,
  sessionLabel,
} from '../../../../src/client/features/permissions/permissions.logic.ts';

const request = (overrides: Partial<PermissionRequestInfo>): PermissionRequestInfo => ({
  id: 'req-1',
  sessionId: '0123456789abcdef',
  tool: 'Bash',
  text: 'rm -rf build',
  createdMs: 1,
  status: 'pending',
  ...overrides,
});

const entry = (overrides: Partial<AuditEntry>): AuditEntry => ({ ts: '2026-10-09T10:00:00.000Z', action: 'approval', ...overrides });

test('pendingRequests drops expired requests and tolerates a missing list', () => {
  const state = { permissions: [request({ id: 'a' }), request({ id: 'b', status: 'expired' })] };
  assert.deepEqual(pendingRequests(state).map((item) => item.id), ['a']);
  assert.deepEqual(pendingRequests({} as { permissions: PermissionRequestInfo[] }), []);
});

test('canAnswer is false on the PC and with commands off, true on a paired device', () => {
  assert.equal(canAnswer({ commands: true, manageDevices: true }), false);
  assert.equal(canAnswer({ commands: false, manageDevices: false }), false);
  assert.equal(canAnswer({ commands: true, manageDevices: false }), true);
});

test('sessionLabel uses the session name, else the first 8 characters of the id', () => {
  const sessions = [{ sessionId: 'abc', name: 'my task' }];
  assert.equal(sessionLabel('abc', sessions), 'my task');
  assert.equal(sessionLabel('0123456789abcdef', sessions), '01234567');
});

test('answerErrorMessage maps known server strings and hides everything else', () => {
  assert.equal(answerErrorMessage('answering needs a paired device'), 'Answering needs a paired device.');
  assert.equal(answerErrorMessage('permission request already answered or expired'), 'This request expired or was already answered.');
  assert.equal(answerErrorMessage('unknown permission request'), 'This request expired or was already answered.');
  assert.equal(answerErrorMessage('Unexpected token } in JSON at secret'), 'Could not send the answer.');
  assert.equal(answerErrorMessage('constructor'), 'Could not send the answer.');
  assert.equal(answerErrorMessage(null), 'Could not send the answer.');
});

test('approvalRowOf labels outcomes, shortens the session and fills missing fields', () => {
  const row = approvalRowOf(entry({ outcome: 'deny', session: '0123456789abcdef', tool: 'Edit', text: 'x', device: 'phone' }));
  assert.equal(row.outcome, 'Denied');
  assert.equal(row.session, '01234567');
  assert.equal(row.device, 'phone');
  assert.equal(approvalRowOf(entry({ outcome: 'allow' })).outcome, 'Allowed');
  assert.equal(approvalRowOf(entry({ outcome: 'expired' })).outcome, 'Expired');
  const bare = approvalRowOf(entry({}));
  assert.deepEqual([bare.device, bare.session, bare.tool, bare.text, bare.outcome], ['unknown', '', '', '', 'Unknown']);
  assert.equal(approvalRowOf(entry({ deviceId: 'pc' })).device, 'pc');
});

test('the PC hint tells where to answer', () => {
  assert.ok(PC_HINT.startsWith('Answer from a paired phone or tablet'));
  assert.ok(PC_HINT.includes('`claude attach`'));
});

test('approvalRowOf gives the outcome class, falling back to unknown', () => {
  assert.equal(approvalRowOf(entry({ outcome: 'allow' })).outcomeClass, 'allow');
  assert.equal(approvalRowOf(entry({ outcome: 'weird' })).outcomeClass, 'unknown');
  assert.equal(approvalRowOf(entry({})).outcomeClass, 'unknown');
});

test('approvalEntriesOf accepts the response shape and rejects anything else', () => {
  assert.deepEqual(approvalEntriesOf({ approvals: [] }), []);
  assert.equal(approvalEntriesOf(null), null);
  assert.equal(approvalEntriesOf({ approvals: 'x' }), null);
  assert.equal(approvalEntriesOf({}), null);
});

test('approvalEntriesOf keeps string fields and skips items without ts and action', () => {
  const entries = approvalEntriesOf({
    approvals: [{ ts: 't', action: 'approval', tool: 'Bash', text: 'ls', outcome: 'allow', device: 5 }, { ts: 't' }, 'x', null],
  });
  assert.equal(entries?.length, 1);
  assert.equal(entries?.[0]?.tool, 'Bash');
  assert.equal(entries?.[0]?.device, undefined);
});
