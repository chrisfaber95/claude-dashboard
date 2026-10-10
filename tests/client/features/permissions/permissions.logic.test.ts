// Permission prompt logic: pending filter, who may answer, fixed error messages, approval rows and escaping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AuditEntry, PermissionRequestInfo } from '../../../../src/shared/types/index.ts';
import {
  PC_HINT,
  answerErrorMessage,
  approvalListHtml,
  approvalRowOf,
  canAnswer,
  pendingRequests,
  requestItemHtml,
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

test('request text and tool are escaped in the pending item', () => {
  const html = requestItemHtml(request({ text: '<img src=x onerror=alert(1)>', tool: '<b>' }), '"><script>', true, undefined, 'alerts');
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('data-permission-decide="allow"'));
});

test('a busy request has disabled buttons; the PC gets the hint instead of buttons', () => {
  const busy = requestItemHtml(request({}), 'label', true, { isBusy: true, message: '' }, 'sessions');
  assert.equal(busy.match(/ disabled/g)?.length, 2);
  const failed = requestItemHtml(request({}), 'label', true, { isBusy: false, message: 'Could not send the answer.' }, 'sessions');
  assert.ok(!failed.includes(' disabled'));
  assert.ok(failed.includes('Could not send the answer.'));
  const pc = requestItemHtml(request({}), 'label', false, undefined, 'sessions');
  assert.ok(!pc.includes('data-permission-decide'));
  assert.ok(pc.includes('`claude attach`'));
  assert.ok(PC_HINT.startsWith('Answer from a paired phone or tablet'));
});

test('the same request has different keys in the two lists', () => {
  const a = requestItemHtml(request({}), 'l', true, undefined, 'sessions');
  const b = requestItemHtml(request({}), 'l', true, undefined, 'alerts');
  assert.notEqual(a.match(/data-key="[^"]*"/)?.[0], b.match(/data-key="[^"]*"/)?.[0]);
});

test('approvalListHtml escapes entry text and shows an empty state', () => {
  assert.ok(approvalListHtml([]).includes('No approvals yet.'));
  const html = approvalListHtml([entry({ text: '<img onerror=alert(1)>', tool: '<i>', device: '<u>', outcome: 'allow' })]);
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<i>'));
  assert.ok(!html.includes('<u>'));
  assert.ok(html.includes('Allowed'));
});
