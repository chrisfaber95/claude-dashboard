// Feed helpers of the messages popup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MessageInfo } from '../../../../src/shared/types/index.ts';
import { feedKey, routeText } from '../../../../src/client/features/messages/messages.logic.ts';

const message = (direction: 'in' | 'out'): MessageInfo => ({
  tsMs: 5, kind: 'session', direction, sessionId: 's1', sessionName: 'a', peer: 'b', snippet: '',
});

test('routeText orders sender and receiver by direction', () => {
  assert.equal(routeText(message('out')), 'a → b');
  assert.equal(routeText(message('in')), 'b → a');
});

test('feedKey differs between directions', () => {
  assert.notEqual(feedKey(message('out')), feedKey(message('in')));
});
