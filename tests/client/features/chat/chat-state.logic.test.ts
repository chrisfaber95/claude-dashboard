// Chat state: the pending message awaiting confirmation and the bounded history.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HISTORY_MAX, createChatState } from '../../../../src/client/features/chat/chat-state.logic.ts';

const pending = { sessionId: 'abc-123', name: 'worker', text: 'run the tests' };

test('confirm returns the captured session and text, once', () => {
  const chat = createChatState();
  chat.setPending(pending);
  assert.deepEqual(chat.pending, pending);
  assert.deepEqual(chat.confirm(), pending);
  assert.equal(chat.pending, null);
  assert.equal(chat.confirm(), null);
});

test('the pending message is a copy: later changes to the input object do not leak in', () => {
  const chat = createChatState();
  const input = { ...pending };
  chat.setPending(input);
  input.text = 'something else';
  input.sessionId = 'other';
  assert.deepEqual(chat.confirm(), pending);
});

test('cancel clears the pending message', () => {
  const chat = createChatState();
  chat.setPending(pending);
  chat.cancel();
  assert.equal(chat.pending, null);
  assert.equal(chat.confirm(), null);
});

test('a new user input cancels the pending message', () => {
  const chat = createChatState();
  chat.setPending(pending);
  chat.addUser('never mind');
  assert.equal(chat.pending, null);
  assert.equal(chat.confirm(), null);
});

test('a bot reply does not cancel the pending message; a newer pending replaces the older', () => {
  const chat = createChatState();
  chat.setPending(pending);
  chat.addBot('Send to worker?');
  assert.deepEqual(chat.pending, pending);
  chat.setPending({ sessionId: 'x', name: 'y', text: 'z' });
  assert.deepEqual(chat.confirm(), { sessionId: 'x', name: 'y', text: 'z' });
});

test('history keeps roles and order, with unique increasing ids', () => {
  const chat = createChatState();
  const first = chat.addUser('hi');
  const second = chat.addBot('hello');
  assert.deepEqual(chat.history.map((entry) => [entry.role, entry.text]), [['user', 'hi'], ['bot', 'hello']]);
  assert.ok(second.id > first.id);
});

test('history is bounded and drops the oldest entries', () => {
  const chat = createChatState();
  for (let i = 0; i < HISTORY_MAX + 10; i++) chat.addUser(`m${i}`);
  assert.equal(chat.history.length, HISTORY_MAX);
  assert.equal(chat.history[0]?.text, 'm10');
  assert.equal(chat.history.at(-1)?.text, `m${HISTORY_MAX + 9}`);
  const small = createChatState(3);
  for (let i = 0; i < 5; i++) small.addBot(`b${i}`);
  assert.deepEqual(small.history.map((entry) => entry.text), ['b2', 'b3', 'b4']);
});
