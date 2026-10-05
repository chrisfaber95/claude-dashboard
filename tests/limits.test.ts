import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeFixture } from './helpers.ts';

const fx = makeFixture();
process.env.DASHBOARD_LIVE_USAGE = '1';
const L = await import('../src/server/limits.ts');

const FAKE_TOKEN = 'sk-ant-oat01-FAKE-TEST-TOKEN';
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const apiBody = {
  five_hour: { utilization: 12.5, resets_at: '2026-10-02T03:00:00+00:00' },
  seven_day: { utilization: 58, resets_at: '2026-10-03T00:00:00.328423+00:00' },
  seven_day_opus: null,
  seven_day_sonnet: { utilization: 3, resets_at: null },
  extra_usage: { is_enabled: false },
};

test('toWindows keeps known windows in a fixed order and skips nulls', () => {
  const w = L.toWindows(apiBody);
  assert.deepEqual(
    w.map((x) => [x.key, x.label, x.utilization, x.resetsAtMs]),
    [
      ['five_hour', '5-hour', 12.5, Date.parse('2026-10-02T03:00:00Z')],
      ['seven_day', '7-day', 58, Date.parse('2026-10-03T00:00:00.328Z')],
      ['seven_day_sonnet', '7-day Sonnet', 3, null],
    ],
  );
  assert.deepEqual(L.toWindows(null), []);
});

test('falls back to the .claude.json cache and reports the poll error', async () => {
  writeFileSync(
    fx.claudeJson,
    JSON.stringify({ cachedUsageUtilization: { fetchedAtMs: 1000, utilization: { seven_day: { utilization: 40, resets_at: null } } } }),
  );
  rmSync(join(fx.claudeDir, '.credentials.json'), { force: true });
  await L.pollLive();
  const r = L.getLimits();
  assert.equal(r.source, 'cache');
  assert.equal(r.fetchedAtMs, 1000);
  assert.equal(r.windows[0].utilization, 40);
  assert.equal(r.error, 'credentials unreadable', 'fixed message, never the raw fs error');
});

test('survives a half-written cache file', () => {
  writeFileSync(fx.claudeJson, '{"cachedUsageUtil');
  const r = L.getLimits();
  assert.ok(['none', 'cache', 'live'].includes(r.source));
});

test('live poll sends the bearer token and never exposes it', async () => {
  writeFileSync(join(fx.claudeDir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: FAKE_TOKEN } }));
  let seen: { url: string; headers: Record<string, string> } | null = null;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen = { url, headers: init.headers as Record<string, string> };
    return new Response(JSON.stringify(apiBody), { status: 200 });
  }) as typeof fetch;

  await L.pollLive();
  const r = L.getLimits();
  assert.equal(seen!.url, 'https://api.anthropic.com/api/oauth/usage');
  assert.equal(seen!.headers.Authorization, `Bearer ${FAKE_TOKEN}`);
  assert.equal(seen!.headers['anthropic-beta'], 'oauth-2025-04-20');
  assert.equal(r.source, 'live');
  assert.equal(r.error, null);
  assert.equal(r.windows.find((w) => w.key === 'five_hour')!.utilization, 12.5);
  assert.ok(!JSON.stringify(r).includes(FAKE_TOKEN));
});

test('keeps the last good live data when a later poll fails', async () => {
  globalThis.fetch = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
  await L.pollLive();
  const r = L.getLimits();
  assert.equal(r.source, 'live');
  assert.equal(r.error, 'usage API responded 401');
  assert.ok(!(r.error ?? '').includes(FAKE_TOKEN));
});

test('rejects an unexpected response shape', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ hello: 1 }), { status: 200 })) as unknown as typeof fetch;
  await L.pollLive();
  assert.equal(L.getLimits().error, 'unexpected usage API response shape');
});

test('never surfaces raw credential or network errors', async () => {
  writeFileSync(join(fx.claudeDir, '.credentials.json'), `{"claudeAiOauth":{"accessToken":"${FAKE_TOKEN}"`); // truncated JSON
  await L.pollLive();
  assert.equal(L.getLimits().error, 'credentials unreadable');
  assert.ok(!JSON.stringify(L.getLimits()).includes('FAKE'));

  writeFileSync(join(fx.claudeDir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: FAKE_TOKEN } }));
  globalThis.fetch = (async () => {
    throw new Error(`connect failed for ${FAKE_TOKEN}`);
  }) as unknown as typeof fetch;
  await L.pollLive();
  assert.equal(L.getLimits().error, 'usage API unreachable');
});
