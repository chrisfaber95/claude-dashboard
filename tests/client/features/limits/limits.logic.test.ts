// Limit percentages: clamping, warning levels and the highest utilization.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampPercent, highestUtilization, limitLevelClass, limitStatusText,
} from '../../../../src/client/features/limits/limits.logic.ts';

test('clampPercent keeps values within 0..100', () => {
  assert.equal(clampPercent(-5), 0);
  assert.equal(clampPercent(42), 42);
  assert.equal(clampPercent(130), 100);
});

test('limitLevelClass and limitStatusText switch at 75 and 90 percent', () => {
  assert.equal(limitLevelClass(74.9), '');
  assert.equal(limitLevelClass(75), 'is-warn');
  assert.equal(limitLevelClass(90), 'is-crit');
  assert.equal(limitStatusText(10), '');
  assert.equal(limitStatusText(80), ' · high');
  assert.equal(limitStatusText(95), ' · near limit');
});

test('highestUtilization is the clamped maximum, 0 without windows', () => {
  const window = (utilization: number) => ({ key: 'k', label: 'l', utilization, resetsAtMs: null });
  assert.equal(highestUtilization([]), 0);
  assert.equal(highestUtilization([window(20), window(60)]), 60);
  assert.equal(highestUtilization([window(250)]), 100);
});
