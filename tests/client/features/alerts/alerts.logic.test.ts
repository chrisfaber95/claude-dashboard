// Alert badge count and which alerts are new enough to toast.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Alert } from '../../../../src/shared/types/index.ts';
import { badgeCount, createAlertTracker, parseThreshold, uniqueAlerts } from '../../../../src/client/features/alerts/alerts.logic.ts';

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

test('uniqueAlerts keeps the first alert of each id', () => {
  const first = alert('a');
  const repeated = { ...alert('a'), detail: 'again' };
  assert.deepEqual(uniqueAlerts([first, alert('b'), repeated]).map((item) => item.id), ['a', 'b']);
  assert.equal(uniqueAlerts([first, repeated])[0], first);
});

test('parseThreshold accepts whole numbers from 1 to 100 only', () => {
  assert.equal(parseThreshold('80'), 80);
  assert.equal(parseThreshold('1'), 1);
  assert.equal(parseThreshold('100'), 100);
  for (const text of ['', '0', '101', '12.5', 'abc', '-3']) assert.equal(parseThreshold(text), null, text);
});
