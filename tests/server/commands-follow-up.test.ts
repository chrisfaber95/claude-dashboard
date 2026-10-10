// Follow-up messages to sessions: live, busy, idle and ended sessions, stop-then-resume and audit lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assistantLine, jsonl, transcriptDir } from '../helpers.ts';
import { fx, alpha, SID, rawCalls, calls, post } from './commands-test-setup.ts';

// A live session = a sessions/<pid>.json whose pid is running (this test process).
function makeLive(sessionId: string, kind: string, status: string): string {
  mkdirSync(alpha, { recursive: true });
  writeFileSync(join(transcriptDir(fx, alpha), `${sessionId}.jsonl`), jsonl([assistantLine({ sessionId, cwd: alpha, ts: new Date().toISOString(), id: `m${sessionId}` })]));
  const file = join(fx.claudeDir, 'sessions', `${sessionId.slice(0, 8)}.json`);
  writeFileSync(file, JSON.stringify({ pid: process.pid, sessionId, cwd: alpha, kind, status, startedAt: Date.now() }));
  return file;
}

test('follow-up to a live non-background session is refused with 409 and no CLI call', async () => {
  const id = 'aaaaaaaa-2222-4333-8444-555555555555';
  const file = makeLive(id, 'interactive', 'idle');
  try {
    const response = await post(`/api/sessions/${id}/message`, { prompt: 'hi', permissionMode: 'auto' });
    assert.equal(response.status, 409);
    assert.deepEqual(calls(), []);
  } finally {
    rmSync(file, { force: true });
  }
});

test('follow-up to a busy background session is refused with 409 and no CLI call', async () => {
  const id = 'bbbbbbbb-2222-4333-8444-555555555555';
  const file = makeLive(id, 'bg', 'busy');
  try {
    const response = await post(`/api/sessions/${id}/message`, { prompt: 'hi', permissionMode: 'auto' });
    assert.equal(response.status, 409);
    assert.deepEqual(calls(), []);
  } finally {
    rmSync(file, { force: true });
  }
});

test('follow-up to an idle background session stops it first, then resumes it', async () => {
  const id = 'cccccccc-2222-4333-8444-555555555555';
  const file = makeLive(id, 'bg', 'idle');
  process.env.FAKE_CLAUDE_STOP_REMOVES = file;
  try {
    const response = await post(`/api/sessions/${id}/message`, { prompt: 'continue', permissionMode: 'plan' });
    assert.equal(response.status, 200);
    assert.equal(existsSync(file), false, 'fake stop ended the live session');
    const call = calls();
    assert.deepEqual(
      call.map((item) => item.args),
      [['stop', id.slice(0, 8)], ['--bg', '--resume', id, '--permission-mode', 'plan', 'continue']],
    );
    assert.equal(call[1].cwd.toLowerCase(), alpha.toLowerCase());
  } finally {
    delete process.env.FAKE_CLAUDE_STOP_REMOVES;
    rmSync(file, { force: true });
  }
});

test('follow-up to a session that is not live only resumes it', async () => {
  const id = 'dddddddd-2222-4333-8444-555555555555';
  const file = makeLive(id, 'bg', 'idle');
  rmSync(file, { force: true });
  const response = await post(`/api/sessions/${id}/message`, { prompt: 'again', permissionMode: 'auto' });
  assert.equal(response.status, 200);
  assert.deepEqual(calls().map((call) => call.args), [['--bg', '--resume', id, '--permission-mode', 'auto', 'again']]);
});

test('follow-up to an ended terminal session resumes it in the background under the same id', async () => {
  const id = '12121212-2222-4333-8444-555555555555';
  const file = makeLive(id, 'interactive', 'idle');
  const live = await post(`/api/sessions/${id}/message`, { prompt: 'still open', permissionMode: 'auto' });
  assert.equal(live.status, 409, 'refused while the terminal still has it open');
  assert.deepEqual(calls(), []);
  rmSync(file, { force: true });
  const ended = await post(`/api/sessions/${id}/message`, { prompt: 'continue here', permissionMode: 'plan' });
  assert.equal(ended.status, 200);
  assert.deepEqual(calls().map((call) => call.args), [['--bg', '--resume', id, '--permission-mode', 'plan', 'continue here']]);
});

const auditLines = () =>
  readFileSync(join(fx.dataDir, 'commands.log'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);

test('follow-up to a waiting background session is refused with 409 and no CLI call', async () => {
  const id = 'eeeeeeee-2222-4333-8444-555555555555';
  const file = makeLive(id, 'bg', 'waiting');
  try {
    const response = await post(`/api/sessions/${id}/message`, { prompt: 'hi', permissionMode: 'auto' });
    assert.equal(response.status, 409);
    assert.deepEqual(calls(), []);
  } finally {
    rmSync(file, { force: true });
  }
});

test('stopping an idle session for a follow-up is audited as a stop via message', async () => {
  const id = 'ffffffff-2222-4333-8444-555555555555';
  const file = makeLive(id, 'bg', 'idle');
  process.env.FAKE_CLAUDE_STOP_REMOVES = file;
  try {
    assert.equal((await post(`/api/sessions/${id}/message`, { prompt: 'go', permissionMode: 'auto' })).status, 200);
    const stop = auditLines().find((auditLine) => auditLine.action === 'stop' && auditLine.session === id);
    assert.ok(stop, 'stop was audited');
    assert.equal(stop.via, 'message');
    assert.equal(stop.ok, true);
  } finally {
    delete process.env.FAKE_CLAUDE_STOP_REMOVES;
    rmSync(file, { force: true });
  }
});

test('follow-up gives up with 504 and does not resume when the stopped session stays live', async () => {
  const id = '12121212-2222-4333-8444-555555555555';
  const file = makeLive(id, 'bg', 'idle'); // fake stop exits 0 but leaves the session file
  try {
    const response = await post(`/api/sessions/${id}/message`, { prompt: 'x', permissionMode: 'auto' });
    assert.equal(response.status, 504);
    assert.deepEqual(calls().map((call) => call.args), [['stop', id.slice(0, 8)]]);
  } finally {
    rmSync(file, { force: true });
  }
});

test('follow-up returns 502 and does not resume when stop fails and the session is still live', async () => {
  const id = '13131313-2222-4333-8444-555555555555';
  const file = makeLive(id, 'bg', 'idle');
  process.env.FAKE_CLAUDE_STOP_FAILS = '1';
  try {
    const response = await post(`/api/sessions/${id}/message`, { prompt: 'x', permissionMode: 'auto' });
    assert.equal(response.status, 502);
    assert.deepEqual(calls().map((call) => call.args), [['stop', id.slice(0, 8)]]);
    const stop = auditLines().find((auditLine) => auditLine.action === 'stop' && auditLine.session === id);
    assert.equal(stop?.ok, false);
  } finally {
    delete process.env.FAKE_CLAUDE_STOP_FAILS;
    rmSync(file, { force: true });
  }
});

test('follow-up still resumes when stop fails but the session is gone', async () => {
  const id = '14141414-2222-4333-8444-555555555555';
  const file = makeLive(id, 'bg', 'idle');
  process.env.FAKE_CLAUDE_STOP_FAILS = '1';
  process.env.FAKE_CLAUDE_STOP_REMOVES = file;
  try {
    const response = await post(`/api/sessions/${id}/message`, { prompt: 'again', permissionMode: 'auto' });
    assert.equal(response.status, 200);
    assert.deepEqual(
      calls().map((call) => call.args),
      [['stop', id.slice(0, 8)], ['--bg', '--resume', id, '--permission-mode', 'auto', 'again']],
    );
  } finally {
    delete process.env.FAKE_CLAUDE_STOP_FAILS;
    delete process.env.FAKE_CLAUDE_STOP_REMOVES;
    rmSync(file, { force: true });
  }
});

test('two concurrent follow-ups to one session: one succeeds, the other gets 409, a single resume runs', async () => {
  const id = '15151515-2222-4333-8444-555555555555';
  const file = makeLive(id, 'bg', 'idle');
  rmSync(file, { force: true }); // not live: goes straight to resume
  process.env.FAKE_CLAUDE_RESUME_DELAY_MS = '800';
  try {
    const first = post(`/api/sessions/${id}/message`, { prompt: 'one', permissionMode: 'auto' });
    await new Promise((resolve) => setTimeout(resolve, 300)); // let the first reach the (slow) resume
    const second = await post(`/api/sessions/${id}/message`, { prompt: 'two', permissionMode: 'auto' });
    assert.equal(second.status, 409);
    assert.equal((await first).status, 200);
    const resumes = calls().filter((call) => call.args.includes('--resume'));
    assert.equal(resumes.length, 1);
    assert.equal(resumes[0].args.at(-1), 'one');
    // The lock is released afterwards.
    delete process.env.FAKE_CLAUDE_RESUME_DELAY_MS;
    assert.equal((await post(`/api/sessions/${id}/message`, { prompt: 'three', permissionMode: 'auto' })).status, 200);
  } finally {
    delete process.env.FAKE_CLAUDE_RESUME_DELAY_MS;
  }
});

test('start and follow-up add --settings with only a PermissionRequest hook; other CLI calls are unchanged', async () => {
  await post('/api/commands', { project: 'Alpha', prompt: 'go', permissionMode: 'plan' });
  await post(`/api/sessions/${SID}/message`, { prompt: 'more', permissionMode: 'plan' });
  await post(`/api/sessions/${SID}/stop`, {});
  const [start, resume, stop] = rawCalls();
  for (const call of [start, resume]) {
    const i = call.args.indexOf('--settings');
    assert.equal(call.args[0], '--bg');
    assert.equal(i, 1);
    const settings = JSON.parse(readFileSync(call.args[i + 1], 'utf8'));
    assert.deepEqual(Object.keys(settings), ['hooks']);
    assert.deepEqual(Object.keys(settings.hooks), ['PermissionRequest']);
    assert.match(settings.hooks.PermissionRequest[0].hooks[0].command, /permission-hook\.mjs/);
    assert.ok(!JSON.stringify(settings).includes(readFileSync(join(fx.dataDir, 'hook-secret'), 'utf8').trim()), 'secret not in settings');
  }
  assert.ok(!stop.args.includes('--settings'));
});
