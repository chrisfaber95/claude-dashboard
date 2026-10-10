// Session list helpers: background-session kinds and status dot classes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dotStateClass, isBackgroundSession } from '../../../../src/client/features/sessions/sessions.logic.ts';

test('isBackgroundSession accepts the bg and background kinds only', () => {
  assert.equal(isBackgroundSession({ kind: 'background' }), true);
  assert.equal(isBackgroundSession({ kind: 'bg' }), true);
  assert.equal(isBackgroundSession({ kind: 'interactive' }), false);
});

test('dotStateClass maps busy and idle and falls back to none', () => {
  assert.equal(dotStateClass('busy'), 'is-busy');
  assert.equal(dotStateClass('idle'), 'is-idle');
  assert.equal(dotStateClass('waiting'), '');
});
