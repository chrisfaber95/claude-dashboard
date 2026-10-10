import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assistantLine, jsonl, makeFixture, transcriptDir } from '../../helpers.ts';

const fx = makeFixture();
const { buildState } = await import('../../../src/server/transcripts/state.ts');

// Projects: a normal repo, a worktree (.git file), and a non-git folder.
const alpha = join(fx.projectsRoot, 'Alpha');
mkdirSync(join(alpha, '.git'), { recursive: true });
writeFileSync(join(alpha, '.git', 'HEAD'), 'ref: refs/heads/feature/x\n');

const gitdir = join(alpha, '.git', 'worktrees', 'alpha-wt');
mkdirSync(gitdir, { recursive: true });
writeFileSync(join(gitdir, 'HEAD'), 'ref: refs/heads/wt-branch\n');
const wt = join(fx.projectsRoot, 'Alpha-wt');
mkdirSync(wt);
writeFileSync(join(wt, '.git'), `gitdir: ${gitdir}\n`);

const detached = join(fx.projectsRoot, 'Detached');
mkdirSync(join(detached, '.git'), { recursive: true });
writeFileSync(join(detached, '.git', 'HEAD'), '0a38ca12deadbeef\n');

mkdirSync(join(fx.projectsRoot, 'Plain'));
mkdirSync(join(fx.projectsRoot, '.hidden'));

// Sessions: this test process is "alive"; pid 999999 is not.
const sessions = join(fx.claudeDir, 'sessions');
writeFileSync(
  join(sessions, `${process.pid}.json`),
  JSON.stringify({ pid: process.pid, sessionId: 'live-1', cwd: alpha, name: 'alpha-live', status: 'busy', startedAt: 1, entrypoint: 'cli' }),
);
writeFileSync(
  join(sessions, '999999.json'),
  JSON.stringify({ pid: 999999, sessionId: 'dead-1', cwd: alpha, name: 'alpha-dead', status: 'idle', startedAt: 1 }),
);
writeFileSync(join(sessions, 'broken.json'), '{"pid":');
writeFileSync(join(sessions, `${process.pid}.abc.key`), 'not a session');

const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
writeFileSync(
  join(transcriptDir(fx, alpha), 'live-1.jsonl'),
  jsonl([
    assistantLine({ sessionId: 'live-1', cwd: alpha, ts: iso(now - 1000), id: 'a', gitBranch: 'feature/x' }),
    assistantLine({ sessionId: 'live-1', cwd: alpha, ts: iso(now - 3 * 86_400_000), id: 'b' }),
    assistantLine({ sessionId: 'live-1', cwd: alpha, ts: iso(now - 30 * 86_400_000), id: 'c' }),
    {
      type: 'user', sessionId: 'live-1', cwd: alpha, timestamp: iso(now - 500),
      origin: { kind: 'peer', from: 'plain-session', body: 'hello' },
    },
  ]),
);

const s = buildState();

test('lists only live sessions with their aggregated tokens and branch', () => {
  assert.deepEqual(s.sessions.map((x) => x.name), ['alpha-live']);
  const x = s.sessions[0];
  assert.equal(x.project, 'Alpha');
  assert.equal(x.status, 'busy');
  assert.equal(x.branch, 'feature/x');
  assert.equal(x.tokens.output, 60);
});

test('lists visible project folders with git info and worktree detection', () => {
  const byName = Object.fromEntries(s.projects.map((p) => [p.name, p]));
  assert.deepEqual(Object.keys(byName).sort(), ['Alpha', 'Alpha-wt', 'Detached', 'Plain']);
  assert.equal(byName.Alpha.branch, 'feature/x');
  assert.equal(byName.Alpha.isWorktree, false);
  assert.equal(byName['Alpha-wt'].branch, 'wt-branch');
  assert.equal(byName['Alpha-wt'].isWorktree, true);
  assert.equal(byName.Detached.branch, '0a38ca12');
  assert.equal(byName.Plain.branch, null);
});

test('computes per-project today / 7d / total tokens and sorts live projects first', () => {
  const a = s.projects[0];
  assert.equal(a.name, 'Alpha');
  assert.equal(a.liveSessions, 1);
  assert.equal(a.tokensToday, 100);
  assert.equal(a.tokens7d, 200);
  assert.equal(a.tokensTotal, 300);
});

test('names messages after the receiving live session', () => {
  assert.equal(s.messages.length, 1);
  assert.equal(s.messages[0].sessionName, 'alpha-live');
  assert.equal(s.messages[0].peer, 'plain-session');
});

test('usage days are sorted and totals add up', () => {
  const days = s.usage.days.map((d) => d.day);
  assert.deepEqual(days, [...days].sort());
  assert.deepEqual(s.usage.totals, { input: 30, output: 60, cacheRead: 90, cacheWrite: 120 });
  assert.equal(s.usage.byModel['claude-sonnet-5-5'], 300);
});

test('limits fall back cleanly when no cache file exists', () => {
  assert.equal(s.limits.source, 'none');
  assert.deepEqual(s.limits.windows, []);
});
