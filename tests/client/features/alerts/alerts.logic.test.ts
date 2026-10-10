// Alert badge count and which alerts are new enough to toast.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Alert } from '../../../../src/shared/types/index.ts';
import { badgeCount, createAlertTracker } from '../../../../src/client/features/alerts/alerts.logic.ts';

const alert = (id: string): Alert => ({ id, kind: 'session', title: id, detail: '', sinceMs: 0, resetsAtMs: null });

test('badgeCount is the number of open alerts', () => {
  assert.equal(badgeCount([]), 0);
  assert.equal(badgeCount([alert('a'), alert('b')]), 2);
});

test('the first state is a baseline: nothing toasts after a page load', () => {
  const tracker = createAlertTracker();
  assert.deepEqual(tracker.update([alert('a'), alert('b')]), []);
  assert.deepEqual(tracker.update([alert('a'), alert('b')]), []);
});

test('a first state without alerts is still the baseline', () => {
  const tracker = createAlertTracker();
  assert.deepEqual(tracker.update([]), []);
  assert.deepEqual(tracker.update([alert('a')]).map((a) => a.id), ['a']);
});

test('only ids missing from the previous state are new; repeats do not toast again', () => {
  const tracker = createAlertTracker();
  tracker.update([alert('a')]);
  assert.deepEqual(tracker.update([alert('a'), alert('b')]).map((a) => a.id), ['b']);
  assert.deepEqual(tracker.update([alert('a'), alert('b')]), []);
});

test('an alert that clears and returns toasts again', () => {
  const tracker = createAlertTracker();
  tracker.update([alert('a')]);
  assert.deepEqual(tracker.update([]), []);
  assert.deepEqual(tracker.update([alert('a')]).map((a) => a.id), ['a']);
});
