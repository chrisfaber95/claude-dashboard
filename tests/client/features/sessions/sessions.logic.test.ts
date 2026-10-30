// Session list helpers: background and headless sessions, and status dot classes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dotStateClass, isBackgroundSession } from '../../../../src/client/features/sessions/sessions.logic.ts';

test('isBackgroundSession accepts the bg and background kinds and sdk entrypoints only', () => {
  assert.equal(isBackgroundSession({ kind: 'background', entrypoint: 'cli' }), true);
  assert.equal(isBackgroundSession({ kind: 'bg', entrypoint: 'cli' }), true);
  assert.equal(isBackgroundSession({ kind: 'interactive', entrypoint: 'sdk-cli' }), true);
  assert.equal(isBackgroundSession({ kind: 'interactive', entrypoint: 'cli' }), false);
  assert.equal(isBackgroundSession({ kind: 'interactive', entrypoint: '' }), false);
});

test('dotStateClass maps busy and idle and falls back to none', () => {
  assert.equal(dotStateClass('busy'), 'is-busy');
  assert.equal(dotStateClass('idle'), 'is-idle');
  assert.equal(dotStateClass('waiting'), '');
});
