// Popup buttons: order, toggling, closing rules and which sections draw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { UsageDay } from '../../../../src/shared/types/index.ts';
import { POPUPS, backdropCloses, openPopup, escapeClosesPopup, isPopupId, stillOpen, toggled, tokensToday, visiblePopups } from '../../../../src/client/features/popups/popups.logic.ts';

test('the button set and order are fixed', () => {
  assert.deepEqual(
    POPUPS.map((popup) => popup.id),
    ['projects', 'comms', 'team', 'usage', 'chat', 'run', 'devices', 'audit', 'approvals'],
  );
});

const NOTHING = { hasTeamBoard: false, canRunCommands: false, canManageDevices: false };

test('without a board, commands or device rights only the always-on buttons show, order kept', () => {
  assert.deepEqual(visiblePopups(NOTHING), ['projects', 'comms', 'usage', 'chat', 'audit']);
});

test('each capability adds only its own buttons', () => {
  assert.deepEqual(visiblePopups({ ...NOTHING, hasTeamBoard: true }), ['projects', 'comms', 'team', 'usage', 'chat', 'audit']);
  assert.deepEqual(visiblePopups({ ...NOTHING, canRunCommands: true }), ['projects', 'comms', 'usage', 'chat', 'run', 'audit', 'approvals']);
  assert.deepEqual(visiblePopups({ ...NOTHING, canManageDevices: true }), ['projects', 'comms', 'usage', 'chat', 'devices', 'audit']);
});

test('with everything allowed every button shows', () => {
  const all = { hasTeamBoard: true, canRunCommands: true, canManageDevices: true };
  assert.deepEqual(visiblePopups(all), POPUPS.map((popup) => popup.id));
});

test('isPopupId accepts only known ids', () => {
  assert.equal(isPopupId('team'), true);
  assert.equal(isPopupId('nope'), false);
  assert.equal(isPopupId(undefined), false);
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
  const day = (date: string): UsageDay => ({ day: date, tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }, byProject: {}, byModel: {} });
  const now = new Date(2026, 9, 9, 12);
  assert.equal(tokensToday([day('2026-10-08'), day('2026-10-09')], now), 10);
  assert.equal(tokensToday([day('2026-10-08')], now), 0);
});

test('drawsSection: closed popup sections are skipped, the open one and non-popup sections draw', async () => {
  const { drawsSection } = await import('../../../../src/client/features/popups/popups.logic.ts');
  assert.equal(drawsSection('usage', null), false);
  assert.equal(drawsSection('usage', 'projects'), false);
  assert.equal(drawsSection('usage', 'usage'), true);
  assert.equal(drawsSection('sessions', null), true);
});

test('openPopup reveals the popup, then renders it', () => {
  const calls: string[] = [];
  openPopup('usage', (id) => calls.push(`reveal ${id}`), (id) => calls.push(`render ${id}`));
  assert.deepEqual(calls, ['reveal usage', 'render usage']);
});
