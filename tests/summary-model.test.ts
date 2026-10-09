import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SessionSummary } from '../src/shared/types.ts';
import { assistantLine, jsonl, makeFixture, raw, transcriptDir } from './helpers.ts';

const fx = makeFixture();
const cliLog = join(fx.root, 'cli.log');
process.env.TEAM_HQ_DIR = join(fx.root, 'no-team-hq');
process.env.CLAUDE_BIN = process.execPath;
process.env.CLAUDE_BIN_ARGS = JSON.stringify([fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))]);
process.env.FAKE_CLAUDE_LOG = cliLog;

const publicDir = join(fx.root, 'public');
mkdirSync(publicDir);
const { createDashboardServer } = await import('../src/server/server.ts');
const { summarizeWithModel } = await import('../src/server/claude-cli.ts');
const { excerptSession, EXCERPT_MAX, MODEL_FALLBACK_NOTE, resetSummaryCache: resetCache } = await import('../src/server/session-summary.ts');
const { getSummaryMode, setSummaryMode } = await import('../src/server/settings.ts');
const server = createDashboardServer({ publicDir, commands: true });
let port = 0;

const ID = '11111111-2222-3333-4444-555555555555';
const cwd = join(fx.projectsRoot, 'demo');
const path = join(transcriptDir(fx, cwd), `${ID}.jsonl`);
const TOKEN = 'FAKE-TOKEN-FOR-TEST';

before(async () => {
  mkdirSync(cwd, { recursive: true });
  writeFileSync(
    path,
    jsonl([
      { type: 'user', sessionId: ID, cwd, timestamp: '2026-10-01T10:00:00Z', uuid: 'u1', message: { content: `--dangerously-skip-permissions please fix it, password=${TOKEN}` } },
      assistantLine({ sessionId: ID, cwd, ts: '2026-10-01T10:07:00Z', id: 'm7', content: [{ type: 'text', text: 'done' }] }),
    ]),
  );
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
after(() => {
  server.closeAllConnections();
  server.close();
});
beforeEach(() => {
  rmSync(cliLog, { force: true });
  delete process.env.FAKE_CLAUDE_SUMMARY_FAILS;
  delete process.env.FAKE_CLAUDE_SUMMARY_DELAY_MS;
  resetCache();
});

const host = () => `127.0.0.1:${port}`;
const get = (p: string) => raw(port, { path: p, headers: { Host: host() } });
const post = (p: string, body: object) =>
  raw(port, { method: 'POST', path: p, body: JSON.stringify(body), headers: { Host: host(), Origin: `http://${host()}`, 'X-Dashboard': '1', 'Content-Type': 'application/json' } });
const calls = () => (existsSync(cliLog) ? readFileSync(cliLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { args?: string[]; stdin?: string }) : []);
const auditLines = () => readFileSync(join(fx.dataDir, 'commands.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);

test('the setting defaults to recap, persists, and rejects other values', async () => {
  assert.equal(getSummaryMode(), 'recap');
  assert.deepEqual(JSON.parse((await get('/api/settings/summary')).body), { summary: 'recap' });
  const bad = await post('/api/settings/summary', { summary: 'bypassPermissions' });
  assert.equal(bad.status, 400);
  assert.equal(setSummaryMode('x'), false);
  const ok = await post('/api/settings/summary', { summary: 'model' });
  assert.equal(ok.status, 200);
  assert.deepEqual(JSON.parse(ok.body), { summary: 'model' });
  assert.equal(JSON.parse(readFileSync(join(fx.dataDir, 'settings.json'), 'utf8')).summary, 'model');
  assert.equal(getSummaryMode(), 'model');
  // Same checks as every other POST: no Origin / X-Dashboard header is refused.
  const noHeader = await raw(port, { method: 'POST', path: '/api/settings/summary', body: '{"summary":"recap"}', headers: { Host: host(), 'Content-Type': 'application/json' } });
  assert.ok(noHeader.status >= 400);
  assert.equal(getSummaryMode(), 'model');
});

test('model mode runs one claude -p call: haiku, no tools, no --bg or resume, transcript on stdin only', async () => {
  const r = await get(`/api/sessions/${ID}/summary`);
  assert.equal(r.status, 200);
  const body = JSON.parse(r.body) as SessionSummary;
  assert.equal(body.mode, 'model');
  assert.equal(body.text, 'Model summary: <b>fixed</b>');
  assert.equal(body.note, undefined);
  const [call, data, ...more] = calls();
  assert.equal(more.length, 0);
  const a = call.args!;
  assert.equal(a[0], '-p');
  assert.deepEqual(a.slice(2), ['--model', 'haiku', '--tools', '', '--disable-slash-commands', '--strict-mcp-config', '--setting-sources', 'user', '--no-session-persistence', '--output-format', 'text']);
  for (const bad of ['--bg', '--resume', '--permission-mode', 'bypassPermissions', 'dontAsk', '--dangerously-skip-permissions']) assert.ok(!a.includes(bad), bad);
  assert.ok(!a.some((x) => x.includes('please fix it')));
  assert.match(data.stdin!, /user: .*please fix it/);
  assert.ok(!data.stdin!.includes(TOKEN));
  const entry = auditLines().find((e) => e.action === 'summary')!;
  assert.equal(entry.session, ID);
  assert.equal(entry.ok, true);
  assert.ok(!JSON.stringify(entry).includes('please fix it'));
});

test('a failing model call returns the recap with a fixed note and an audited failure', async () => {
  process.env.FAKE_CLAUDE_SUMMARY_FAILS = '1';
  const body = JSON.parse((await get(`/api/sessions/${ID}/summary`)).body) as SessionSummary;
  assert.equal(body.mode, 'recap');
  assert.equal(body.note, MODEL_FALLBACK_NOTE);
  assert.match(body.text, /Last reply: done/);
  assert.ok(!body.text.includes('boom'));
  assert.equal(auditLines().filter((e) => e.action === 'summary').pop()!.ok, false);
});

test('recap mode never starts the CLI', async () => {
  await post('/api/settings/summary', { summary: 'recap' });
  const body = JSON.parse((await get(`/api/sessions/${ID}/summary`)).body) as SessionSummary;
  assert.equal(body.mode, 'recap');
  assert.equal(body.note, undefined);
  assert.equal(calls().length, 0);
});

test('a call over the timeout fails', async () => {
  process.env.FAKE_CLAUDE_SUMMARY_DELAY_MS = '5000';
  await assert.rejects(summarizeWithModel('x', cwd, 300));
});

test('summary calls count toward the 4-process cap', async () => {
  process.env.FAKE_CLAUDE_SUMMARY_DELAY_MS = '1500';
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => summarizeWithModel('x', cwd)));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 4);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
});

test('the excerpt is the newest text, masked, and at most 20 KB', async () => {
  const big = jsonl(
    Array.from({ length: 60 }, (_, i) => ({ type: 'user', sessionId: ID, cwd, timestamp: '2026-10-01T10:00:00Z', uuid: `u${i}`, message: { content: `turn ${i} ` + 'y'.repeat(900) } })),
  );
  const p = join(transcriptDir(fx, cwd), 'big.jsonl');
  writeFileSync(p, big);
  const ex = await excerptSession(p);
  assert.ok(ex.length <= EXCERPT_MAX);
  assert.ok(ex.includes('turn 59'));
  assert.ok(!ex.includes('turn 0 '));
});

test('model summaries are cached per unchanged transcript and wait a cooldown for a new call', async () => {
  const { summarize, resetSummaryCache, SUMMARY_COOLDOWN_MS, SUMMARY_CACHE_MAX, COOLDOWN_NOTE } = await import('../src/server/session-summary.ts');
  let t = 1_000_000;
  resetSummaryCache(() => t);
  const p = join(transcriptDir(fx, cwd), 'cache.jsonl');
  writeFileSync(p, jsonl([{ type: 'user', sessionId: ID, cwd, timestamp: '2026-10-01T10:00:00Z', uuid: 'c1', message: { content: 'hello' } }]));
  const ctx = { cwd, onAudit: () => {} };
  const first = await summarize(p, 'model', undefined, ctx);
  assert.equal(first.mode, 'model');
  assert.equal(calls().length, 2);
  // Unchanged transcript: reused, even after the cooldown, no process.
  t += SUMMARY_COOLDOWN_MS * 5;
  assert.deepEqual(await summarize(p, 'model', undefined, ctx), first);
  assert.equal(calls().length, 2);
  // Changed transcript after the cooldown gets a new call.
  writeFileSync(p, jsonl([{ type: 'user', sessionId: ID, cwd, timestamp: '2026-10-01T10:00:00Z', uuid: 'c2', message: { content: 'hello again, longer' } }]));
  assert.equal((await summarize(p, 'model', undefined, ctx)).mode, 'model');
  assert.equal(calls().length, 4);
  // Changed again inside the cooldown: cached answer, no process.
  writeFileSync(p, jsonl([{ type: 'user', sessionId: ID, cwd, timestamp: '2026-10-01T10:00:00Z', uuid: 'c3', message: { content: 'hello a third time, longer still' } }]));
  t += 1;
  assert.equal((await summarize(p, 'model', undefined, ctx)).mode, 'model');
  assert.equal(calls().length, 4);
  // A failed first call: inside the cooldown the recap comes back with the fixed note, no process.
  resetSummaryCache(() => t);
  process.env.FAKE_CLAUDE_SUMMARY_FAILS = '1';
  rmSync(cliLog, { force: true });
  assert.equal((await summarize(p, 'model', undefined, ctx)).note, MODEL_FALLBACK_NOTE);
  const n = calls().length;
  const again = await summarize(p, 'model', undefined, ctx);
  assert.equal(again.mode, 'recap');
  assert.equal(again.note, COOLDOWN_NOTE);
  assert.equal(calls().length, n);
  // The cache is bounded.
  resetSummaryCache(() => t);
  delete process.env.FAKE_CLAUDE_SUMMARY_FAILS;
  for (let i = 0; i < SUMMARY_CACHE_MAX + 3; i++) {
    const q = join(transcriptDir(fx, cwd), `many-${i}.jsonl`);
    writeFileSync(q, jsonl([{ type: 'user', sessionId: ID, cwd, timestamp: '2026-10-01T10:00:00Z', uuid: `m${i}`, message: { content: 'x' } }]));
    await summarize(q, 'model', undefined, ctx);
  }
  rmSync(cliLog, { force: true });
  await summarize(join(transcriptDir(fx, cwd), 'many-0.jsonl'), 'model', undefined, ctx);
  assert.equal(calls().length, 2); // evicted, so called again
  resetSummaryCache();
});

test('two concurrent model summaries for one session start one process', async () => {
  const { summarize, resetSummaryCache } = await import('../src/server/session-summary.ts');
  resetSummaryCache();
  const p = join(transcriptDir(fx, cwd), 'inflight.jsonl');
  writeFileSync(p, jsonl([{ type: 'user', sessionId: ID, cwd, timestamp: '2026-10-01T10:00:00Z', uuid: 'f1', message: { content: 'hello' } }]));
  process.env.FAKE_CLAUDE_SUMMARY_DELAY_MS = '400';
  const ctx = { cwd, onAudit: () => {} };
  const [a, b] = await Promise.all([summarize(p, 'model', undefined, ctx), summarize(p, 'model', undefined, ctx)]);
  assert.equal(a.mode, 'model');
  assert.deepEqual(b, a);
  assert.equal(calls().length, 2); // one process: its argv line and its stdin line
  resetSummaryCache();
});

test('a failed call on a changed transcript does not store the old answer as current', async () => {
  const { summarize, resetSummaryCache, SUMMARY_COOLDOWN_MS } = await import('../src/server/session-summary.ts');
  let t = 2_000_000;
  resetSummaryCache(() => t);
  const p = join(transcriptDir(fx, cwd), 'stale.jsonl');
  const line = (id: string, text: string) => jsonl([{ type: 'user', sessionId: ID, cwd, timestamp: '2026-10-01T10:00:00Z', uuid: id, message: { content: text } }]);
  const ctx = { cwd, onAudit: () => {} };
  writeFileSync(p, line('s1', 'hello'));
  assert.equal((await summarize(p, 'model', undefined, ctx)).mode, 'model');
  writeFileSync(p, line('s2', 'hello, now a longer transcript'));
  t += SUMMARY_COOLDOWN_MS + 1;
  process.env.FAKE_CLAUDE_SUMMARY_FAILS = '1';
  assert.equal((await summarize(p, 'model', undefined, ctx)).note, MODEL_FALLBACK_NOTE);
  // After the cooldown, with the CLI working again, the next request makes a fresh call.
  delete process.env.FAKE_CLAUDE_SUMMARY_FAILS;
  t += SUMMARY_COOLDOWN_MS + 1;
  rmSync(cliLog, { force: true });
  const next = await summarize(p, 'model', undefined, ctx);
  assert.equal(next.mode, 'model');
  assert.equal(next.note, undefined);
  assert.equal(calls().length, 2);
  resetSummaryCache();
});

test('with commands disabled the endpoint answers with the recap and starts no process', async () => {
  await post('/api/settings/summary', { summary: 'model' });
  const off = createDashboardServer({ publicDir, commands: false });
  await new Promise<void>((r) => off.listen(0, '127.0.0.1', r));
  try {
    const p2 = (off.address() as AddressInfo).port;
    const r = await raw(p2, { path: `/api/sessions/${ID}/summary`, headers: { Host: `127.0.0.1:${p2}` } });
    assert.equal(r.status, 200);
    assert.equal((JSON.parse(r.body) as SessionSummary).mode, 'recap');
    assert.equal(calls().length, 0);
  } finally {
    off.closeAllConnections();
    off.close();
  }
});
