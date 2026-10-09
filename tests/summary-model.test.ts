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
const { excerptSession, EXCERPT_MAX, MODEL_FALLBACK_NOTE } = await import('../src/server/session-summary.ts');
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
