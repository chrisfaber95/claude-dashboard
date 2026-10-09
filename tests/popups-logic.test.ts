import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { UsageDay } from '../src/shared/types.ts';
import { POPUPS, backdropCloses, escapeClosesPopup, stillOpen, toggled, tokensToday, visiblePopups } from '../src/client/popups-logic.ts';

test('the button set and order are fixed', () => {
  assert.deepEqual(
    POPUPS.map((p) => p.id),
    ['projects', 'comms', 'team', 'usage', 'chat', 'run', 'devices', 'audit'],
  );
});

test('buttons of hidden sections are left out, order kept', () => {
  const hidden = new Set(['team', 'run', 'devices']);
  assert.deepEqual(visiblePopups((id) => hidden.has(id)), ['projects', 'comms', 'usage', 'chat', 'audit']);
});

test('opening replaces the open popup; the same button closes it', () => {
  assert.equal(toggled(null, 'chat'), 'chat');
  assert.equal(toggled('chat', 'usage'), 'usage');
  assert.equal(toggled('usage', 'usage'), null);
});

test('an open popup closes when its section is no longer visible', () => {
  assert.equal(stillOpen('team', ['projects', 'team']), 'team');
  assert.equal(stillOpen('team', ['projects']), null);
  assert.equal(stillOpen(null, ['projects']), null);
});

test('Esc closes the popup only when nothing is stacked above it', () => {
  assert.equal(escapeClosesPopup('Escape', 'projects', false), true);
  assert.equal(escapeClosesPopup('Escape', 'projects', true), false);
  assert.equal(escapeClosesPopup('Escape', null, false), false);
  assert.equal(escapeClosesPopup('a', 'projects', false), false);
});

test('only a click on the backdrop itself closes', () => {
  const backdrop = {};
  assert.equal(backdropCloses(backdrop, backdrop), true);
  assert.equal(backdropCloses({}, backdrop), false);
});

test("tokensToday sums today's four counters and is 0 without a day", () => {
  const day = (d: string): UsageDay => ({ day: d, tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }, byProject: {}, byModel: {} });
  const now = new Date(2026, 9, 9, 12);
  assert.equal(tokensToday([day('2026-10-08'), day('2026-10-09')], now), 10);
  assert.equal(tokensToday([day('2026-10-08')], now), 0);
});
