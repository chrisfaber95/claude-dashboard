// Config helpers: transcript folder slugs, path normalisation, local day, empty token counts and extra Claude folders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cwdSlug, emptyTokens, localDay, normPath, parseExtraDirs } from '../../src/server/config.ts';

test('cwdSlug matches Claude Code transcript folder naming', () => {
  assert.equal(cwdSlug('n:\\Projects\\ShopApp'), 'n--Projects-ShopApp');
  assert.equal(cwdSlug('N:\\Projects\\Claude-dashboard'), 'N--Projects-Claude-dashboard');
});

test('normPath lowercases, unifies separators and strips trailing slashes', () => {
  assert.equal(normPath('N:/Projects/ShopApp/'), 'n:\\projects\\shopapp');
  assert.equal(normPath('n:\\Projects\\ShopApp\\\\'), 'n:\\projects\\shopapp');
});

test('localDay formats in local time as YYYY-MM-DD', () => {
  const date = new Date(2026, 0, 5, 23, 59); // local
  assert.equal(localDay(date.getTime()), '2026-01-05');
});

test('emptyTokens returns a fresh zeroed object each call', () => {
  const a = emptyTokens();
  a.input = 5;
  assert.deepEqual(emptyTokens(), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
});

test('parseExtraDirs reads label=path entries and skips incomplete ones', () => {
  assert.deepEqual(parseExtraDirs(''), []);
  assert.deepEqual(parseExtraDirs('inbox=/var/lib/inbox/.claude; work = N:\\Work\\.claude ;'), [
    { label: 'inbox', dir: '/var/lib/inbox/.claude' },
    { label: 'work', dir: 'N:\\Work\\.claude' },
  ]);
  assert.deepEqual(parseExtraDirs('/no/label;=/no/label;nolabel='), []);
});
