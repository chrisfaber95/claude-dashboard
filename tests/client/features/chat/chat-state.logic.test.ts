import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HISTORY_MAX, createChatState } from '../../../../src/client/features/chat/chat-state.logic.ts';

const pending = { sessionId: 'abc-123', name: 'worker', text: 'run the tests' };

test('confirm returns the captured session and text, once', () => {
  const c = createChatState();
  c.setPending(pending);
  assert.deepEqual(c.pending, pending);
  assert.deepEqual(c.confirm(), pending);
  assert.equal(c.pending, null);
  assert.equal(c.confirm(), null);
});

test('the pending message is a copy: later changes to the input object do not leak in', () => {
  const c = createChatState();
  const p = { ...pending };
  c.setPending(p);
  p.text = 'something else';
  p.sessionId = 'other';
  assert.deepEqual(c.confirm(), pending);
});

test('cancel clears the pending message', () => {
  const c = createChatState();
  c.setPending(pending);
  c.cancel();
  assert.equal(c.pending, null);
  assert.equal(c.confirm(), null);
});

test('a new user input cancels the pending message', () => {
  const c = createChatState();
  c.setPending(pending);
  c.addUser('never mind');
  assert.equal(c.pending, null);
  assert.equal(c.confirm(), null);
});

test('a bot reply does not cancel the pending message; a newer pending replaces the older', () => {
  const c = createChatState();
  c.setPending(pending);
  c.addBot('Send to worker?');
  assert.deepEqual(c.pending, pending);
  c.setPending({ sessionId: 'x', name: 'y', text: 'z' });
  assert.deepEqual(c.confirm(), { sessionId: 'x', name: 'y', text: 'z' });
});

test('history keeps roles and order, with unique increasing ids', () => {
  const c = createChatState();
  const a = c.addUser('hi');
  const b = c.addBot('hello');
  assert.deepEqual(c.history.map((e) => [e.role, e.text]), [['user', 'hi'], ['bot', 'hello']]);
  assert.ok(b.id > a.id);
});

test('history is bounded and drops the oldest entries', () => {
  const c = createChatState();
  for (let i = 0; i < HISTORY_MAX + 10; i++) c.addUser(`m${i}`);
  assert.equal(c.history.length, HISTORY_MAX);
  assert.equal(c.history[0]?.text, 'm10');
  assert.equal(c.history.at(-1)?.text, `m${HISTORY_MAX + 9}`);
  const small = createChatState(3);
  for (let i = 0; i < 5; i++) small.addBot(`b${i}`);
  assert.deepEqual(small.history.map((e) => e.text), ['b2', 'b3', 'b4']);
});
