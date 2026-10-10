// Usage chart data: per-day series, Other bucket and stacked segments.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { UsageDay } from '../../../../src/shared/types/index.ts';
import {
  daySegments, otherTokensOfDay, OTHER_SERIES, seriesNames, visibleDayTotal,
} from '../../../../src/client/features/usage/usage.logic.ts';

const emptyTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const day = (byProject: Record<string, number>): UsageDay => ({ day: '2026-10-10', byProject, byModel: {}, tokens: emptyTokens });
const projectNames = ['alpha', 'beta'];

test('otherTokensOfDay sums projects that are not listed', () => {
  assert.equal(otherTokensOfDay(day({ alpha: 5, gone: 7, old: 3 }), projectNames), 10);
  assert.equal(otherTokensOfDay(day({}), projectNames), 0);
});

test('seriesNames keeps listed projects with tokens, in project order', () => {
  const days = [day({ beta: 2 }), day({ alpha: 0, beta: 1 })];
  assert.deepEqual(seriesNames(days, projectNames), ['beta']);
  assert.deepEqual(seriesNames([day({ alpha: 1, beta: 1 })], projectNames), ['alpha', 'beta']);
});

test('visibleDayTotal adds Other unless it is hidden', () => {
  const sample = day({ alpha: 4, beta: 6, gone: 10 });
  assert.equal(visibleDayTotal(sample, ['alpha'], projectNames, false), 14);
  assert.equal(visibleDayTotal(sample, ['alpha'], projectNames, true), 4);
});

test('daySegments stacks projects then Other and drops empty pieces', () => {
  const sample = day({ alpha: 4, beta: 0, gone: 2 });
  assert.deepEqual(daySegments(sample, ['alpha', 'beta'], projectNames, false), [
    { name: 'alpha', tokens: 4 },
    { name: OTHER_SERIES, tokens: 2 },
  ]);
  assert.deepEqual(daySegments(sample, ['alpha', 'beta'], projectNames, true), [{ name: 'alpha', tokens: 4 }]);
});
