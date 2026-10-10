import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assistantLine, jsonl, makeFixture, raw, transcriptDir } from './helpers.ts';

const fx = makeFixture();
const cliLog = join(fx.root, 'cli.log');
process.env.CLAUDE_BIN = process.execPath;
process.env.CLAUDE_BIN_ARGS = JSON.stringify([fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))]);
process.env.FAKE_CLAUDE_LOG = cliLog;

const alpha = join(fx.projectsRoot, 'Alpha');
mkdirSync(alpha);
mkdirSync(join(fx.projectsRoot, 'Untrusted'));
const SID = '11111111-2222-4333-8444-555555555555';
writeFileSync(join(transcriptDir(fx, alpha), `${SID}.jsonl`), jsonl([assistantLine({ sessionId: SID, cwd: alpha, ts: new Date().toISOString(), id: 'x' })]));

const publicDir = join(fx.root, 'public');
mkdirSync(publicDir);
const { createDashboardServer } = await import('../src/server/server.ts');
const on = createDashboardServer({ publicDir, commands: true });
const off = createDashboardServer({ publicDir, commands: false });
let port = 0;
let offPort = 0;

before(async () => {
  await new Promise<void>((r) => on.listen(0, '127.0.0.1', r));
  await new Promise<void>((r) => off.listen(0, '127.0.0.1', r));
  port = (on.address() as AddressInfo).port;
  offPort = (off.address() as AddressInfo).port;
});
after(() => {
  for (const s of [on, off]) {
    s.closeAllConnections();
    s.close();
  }
});
beforeEach(() => rmSync(cliLog, { force: true }));

const rawCalls = () =>
  existsSync(cliLog) ? readFileSync(cliLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { args: string[]; cwd: string }) : [];
/** Calls without the dashboard's own `--settings <file>` pair, which has its own test. */
const calls = () =>
  rawCalls().map((c) => {
    const i = c.args.indexOf('--settings');
    return i < 0 ? c : { ...c, args: c.args.filter((_, j) => j !== i && j !== i + 1) };
  });

function post(path: string, body: object, p = port) {
  const host = `127.0.0.1:${p}`;
  return raw(p, {
    method: 'POST',
    path,
    body: JSON.stringify(body),
    headers: { Host: host, Origin: `http://${host}`, 'X-Dashboard': '1', 'Content-Type': 'application/json' },
  });
}
const get = (path: string, p = port) => raw(p, { path, headers: { Host: `127.0.0.1:${p}` } });

test('starts a background task with an exact argument array in the project folder', async () => {
  const r = await post('/api/commands', { project: 'Alpha', prompt: 'list "files" & echo hacked', permissionMode: 'plan' });
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.equal(j.ok, true);
  assert.equal(j.id, 'bg-1a2b3c');
  const [c] = calls();
  assert.deepEqual(c.args, ['--bg', '--permission-mode', 'plan', 'list "files" & echo hacked']);
  assert.equal(c.cwd.toLowerCase(), alpha.toLowerCase());
});

test('defaults to auto mode and neutralises prompts that look like flags', async () => {
  await post('/api/commands', { project: 'Alpha', prompt: '--dangerously-skip-permissions' });
  assert.deepEqual(calls()[0].args, ['--bg', '--permission-mode', 'auto', 'Task:\n--dangerously-skip-permissions']);
});

test('rejects unknown projects, path tricks, unsafe modes and oversized prompts without running the CLI', async () => {
  const cases: object[] = [
    { project: 'Nope', prompt: 'x' },
    { project: '..', prompt: 'x' },
    { project: '../Projects/Alpha', prompt: 'x' },
    { project: 'Alpha', prompt: 'x', permissionMode: 'bypassPermissions' },
    { project: 'Alpha', prompt: 'x', permissionMode: 'dontAsk' },
    { project: 'Alpha', prompt: '' },
    { project: 'Alpha', prompt: 'x'.repeat(20_001) },
    { project: 'Alpha', prompt: 42 },
  ];
  for (const body of cases) assert.equal((await post('/api/commands', body)).status, 400, JSON.stringify(body).slice(0, 80));
  assert.equal(calls().length, 0);
});

test('reports untrusted folders with guidance', async () => {
  const j = JSON.parse((await post('/api/commands', { project: 'Untrusted', prompt: 'hi' })).body);
  assert.equal(j.ok, false);
  assert.match(j.needsTrust, /trust prompt/);
  assert.equal(j.id, undefined);
});

test('follow-ups resume the session in its own folder', async () => {
  const r = await post(`/api/sessions/${SID}/message`, { prompt: 'and now the tests', permissionMode: 'acceptEdits' });
  assert.equal(r.status, 200);
  const [c] = calls();
  assert.deepEqual(c.args, ['--bg', '--resume', SID, '--permission-mode', 'acceptEdits', 'and now the tests']);
  assert.equal(c.cwd.toLowerCase(), alpha.toLowerCase());
  assert.equal((await post('/api/sessions/not-a-uuid/message', { prompt: 'x' })).status, 400);
  assert.equal((await post('/api/sessions/99999999-2222-4333-8444-555555555555/message', { prompt: 'x' })).status, 404);
});

test('stop and logs validate ids before calling the CLI', async () => {
  assert.equal(JSON.parse((await post(`/api/sessions/${SID}/stop`, {})).body).ok, true);
  // The CLI matches jobs by their 8-hex job id; a full session UUID never matches.
  assert.deepEqual(calls()[0].args, ['stop', SID.slice(0, 8)]);
  const logs = JSON.parse((await get(`/api/sessions/bg-1a2b3c/logs`)).body);
  assert.equal(logs.output, 'line one\nline two');
  assert.deepEqual(calls()[1].args, ['logs', 'bg-1a2b3c']);
  await get(`/api/sessions/${SID}/logs`);
  assert.deepEqual(calls()[2].args, ['logs', SID.slice(0, 8)]);
  // Job ids are lowercase hex; an uppercase UUID still finds the job.
  await post(`/api/sessions/${SID.toUpperCase()}/stop`, {});
  assert.deepEqual(calls()[3].args, ['stop', SID.slice(0, 8).toLowerCase()]);
  rmSync(cliLog, { force: true });
  assert.equal((await post('/api/sessions/--help/stop', {})).status, 400);
  assert.equal((await get('/api/sessions/-x/logs')).status, 400);
  assert.equal(calls().length, 0);
});

test('writes an audit log line per command', async () => {
  await post('/api/commands', { project: 'Alpha', prompt: 'audit me', permissionMode: 'plan' });
  const lines = readFileSync(join(fx.dataDir, 'commands.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const last = lines.at(-1);
  assert.equal(last.action, 'start');
  assert.equal(last.project, 'Alpha');
  assert.equal(last.mode, 'plan');
  assert.equal(last.goal, 'audit me');
  assert.equal(last.notesLength, 0);
  assert.equal(last.ok, true);
  assert.ok(last.ip);
  // without a login every caller is this PC
  assert.equal(last.deviceId, 'pc');
  assert.equal(last.device, 'This PC');
});

test('a start with goal and notes sends one prompt with marked sections, goal first', async () => {
  const r = await post('/api/commands', { project: 'Alpha', goal: ' Fix the login bug ', notes: '\nIt only fails on Safari.\n', permissionMode: 'plan' });
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.equal(j.ok, true);
  assert.equal(j.started, true);
  assert.deepEqual(calls()[0].args, ['--bg', '--permission-mode', 'plan', '## Goal\nFix the login bug\n\n## Background notes\nIt only fails on Safari.']);
});

test('empty notes add no notes section; a goal starting with - is still neutralised', async () => {
  await post('/api/commands', { project: 'Alpha', goal: 'Do it', notes: '  \n ' });
  await post('/api/commands', { project: 'Alpha', goal: '--help' });
  await post('/api/commands', { project: 'Alpha', prompt: 'old field' });
  assert.deepEqual(calls().map((c) => c.args[3]), ['Do it', 'Task:\n--help', 'old field']);
});

test('launch refusals are fixed 400 messages and never call the CLI', async () => {
  const cases: Array<[object, string]> = [
    [{ goal: 'x' }, 'project is required'],
    [{ project: 7, goal: 'x' }, 'project is required'],
    [{ project: 'Nope', goal: 'x' }, 'unknown project'],
    [{ project: 'Alpha' }, 'goal is required'],
    [{ project: 'Alpha', goal: '  \n\t ' }, 'goal is required'],
    [{ project: 'Alpha', goal: 'x', notes: 5 }, 'notes must be text'],
    [{ project: 'Alpha', goal: 'x'.repeat(15_000), notes: 'y'.repeat(6_000) }, 'goal and notes together are longer than 20000 characters'],
    [{ project: 'Alpha', goal: 'x', permissionMode: 'bypassPermissions' }, 'permission mode must be one of plan, default, acceptEdits, auto'],
  ];
  for (const [body, error] of cases) {
    const r = await post('/api/commands', body);
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 60));
    assert.equal(JSON.parse(r.body).error, error);
  }
  assert.equal(calls().length, 0);
});

test('a failed start returns the reason, says no session started and is audited as failed', async () => {
  const j = JSON.parse((await post('/api/commands', { project: 'Untrusted', goal: 'hi' })).body);
  assert.equal(j.ok, false);
  assert.equal(j.started, false);
  assert.equal(j.id, undefined);
  assert.match(j.needsTrust, /trust prompt/);
  const last = JSON.parse((await get('/api/launches')).body).launches[0];
  assert.equal(last.project, 'Untrusted');
  assert.equal(last.ok, false);
  assert.equal(last.session, undefined);
});

test('launch audit keeps the goal (500 chars) and the notes length, never the notes text', async () => {
  await post('/api/commands', { project: 'Alpha', goal: 'g'.repeat(700), notes: 'secret-ish notes', permissionMode: 'plan' });
  const text = readFileSync(join(fx.dataDir, 'commands.log'), 'utf8');
  assert.ok(!text.includes('secret-ish'));
  const last = JSON.parse(text.trim().split('\n').at(-1)!);
  assert.equal(last.goal, 'g'.repeat(500));
  assert.equal(last.notesLength, 16);
  assert.equal(last.session, 'bg-1a2b3c');
  assert.equal(last.prompt, undefined);
});

test('GET /api/launches lists only starts, newest first, at most 50, with allowlisted fields', async () => {
  rmSync(join(fx.dataDir, 'commands.log'), { force: true });
  for (let i = 0; i < 52; i++) await post('/api/commands', { project: 'Alpha', goal: `goal ${i}`, notes: 'abc', permissionMode: 'plan' });
  await post(`/api/sessions/${SID}/stop`, {});
  const r = await get('/api/launches');
  assert.equal(r.status, 200);
  const { launches } = JSON.parse(r.body) as { launches: Array<Record<string, unknown>> };
  assert.equal(launches.length, 50);
  assert.deepEqual(launches.slice(0, 2).map((l) => l.goal), ['goal 51', 'goal 50']);
  assert.ok(launches.every((l) => l.action === 'start'));
  assert.deepEqual(launches[0], {
    ts: launches[0].ts, action: 'start', device: 'This PC', deviceId: 'pc', project: 'Alpha', session: 'bg-1a2b3c', mode: 'plan', ok: true, goal: 'goal 51', notesLength: 3,
  });
  assert.equal((await post('/api/launches', {})).status, 404);
});

test('serves the transcript of a known session and rejects bad ids', async () => {
  const r = await get(`/api/sessions/${SID}/transcript`);
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body).entries.map((e: { role: string }) => e.role), ['assistant']);
  assert.equal((await get('/api/sessions/..%2f..%2fsecret/transcript')).status, 400);
  assert.equal((await get('/api/sessions/99999999-2222-4333-8444-555555555555/transcript')).status, 404);
});

test('kill switch disables every command endpoint but keeps the transcript viewer', async () => {
  assert.equal((await post('/api/commands', { project: 'Alpha', prompt: 'x' }, offPort)).status, 404);
  assert.equal((await post(`/api/sessions/${SID}/message`, { prompt: 'x' }, offPort)).status, 404);
  assert.equal((await post(`/api/sessions/${SID}/stop`, {}, offPort)).status, 404);
  assert.equal((await get(`/api/sessions/${SID}/logs`, offPort)).status, 404);
  assert.equal((await get(`/api/sessions/${SID}/transcript`, offPort)).status, 200);
  assert.equal(calls().length, 0);
  assert.equal(JSON.parse((await get('/api/state', offPort)).body).features.commands, false);
});

test('localhost mode refuses other Host headers (DNS rebinding) and cross-site POSTs', async () => {
  assert.equal((await raw(port, { path: '/api/state', headers: { Host: 'evil.example' } })).status, 421);
  const cross = await raw(port, {
    method: 'POST',
    path: '/api/commands',
    body: JSON.stringify({ project: 'Alpha', prompt: 'x' }),
    headers: { Host: `127.0.0.1:${port}`, Origin: 'https://evil.example', 'Content-Type': 'text/plain' },
  });
  assert.equal(cross.status, 403);
  const noHeader = await raw(port, {
    method: 'POST',
    path: '/api/commands',
    body: JSON.stringify({ project: 'Alpha', prompt: 'x' }),
    headers: { Host: `127.0.0.1:${port}`, Origin: `http://127.0.0.1:${port}` },
  });
  assert.equal(noHeader.status, 403);
  assert.equal(calls().length, 0);
});

test('rejects oversized and malformed bodies', async () => {
  const host = `127.0.0.1:${port}`;
  const big = await raw(port, {
    method: 'POST',
    path: '/api/commands',
    body: 'x'.repeat(70 * 1024),
    headers: { Host: host, Origin: `http://${host}`, 'X-Dashboard': '1' },
  }).catch(() => ({ status: 413 }));
  assert.equal(big.status, 413);
  const bad = await raw(port, { method: 'POST', path: '/api/commands', body: '[1,2]', headers: { Host: host, Origin: `http://${host}`, 'X-Dashboard': '1' } });
  assert.equal(bad.status, 400);
});

test('follow-ups refuse sessions whose folder is outside the projects folder', async () => {
  const outside = join(fx.root, 'Elsewhere');
  mkdirSync(outside, { recursive: true });
  const OUT = '22222222-2222-4333-8444-555555555555';
  writeFileSync(join(transcriptDir(fx, outside), `${OUT}.jsonl`), jsonl([assistantLine({ sessionId: OUT, cwd: outside, ts: new Date().toISOString(), id: 'o' })]));
  const r = await post(`/api/sessions/${OUT}/message`, { prompt: 'x', permissionMode: 'auto' });
  assert.equal(r.status, 403);
  assert.equal(calls().length, 0);
  assert.equal((await get(`/api/sessions/${OUT}/transcript`)).status, 200, 'viewing is still allowed');
});

test('cross-site GETs cannot spawn the CLI', async () => {
  const r = await raw(port, { path: '/api/sessions/bg-1a2b3c/logs', headers: { Host: `127.0.0.1:${port}`, 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(r.status, 403);
  assert.equal(calls().length, 0);
});

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
    const r = await post(`/api/sessions/${id}/message`, { prompt: 'hi', permissionMode: 'auto' });
    assert.equal(r.status, 409);
    assert.deepEqual(calls(), []);
  } finally {
    rmSync(file, { force: true });
  }
});

test('follow-up to a busy background session is refused with 409 and no CLI call', async () => {
  const id = 'bbbbbbbb-2222-4333-8444-555555555555';
  const file = makeLive(id, 'bg', 'busy');
  try {
    const r = await post(`/api/sessions/${id}/message`, { prompt: 'hi', permissionMode: 'auto' });
    assert.equal(r.status, 409);
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
    const r = await post(`/api/sessions/${id}/message`, { prompt: 'continue', permissionMode: 'plan' });
    assert.equal(r.status, 200);
    assert.equal(existsSync(file), false, 'fake stop ended the live session');
    const c = calls();
    assert.deepEqual(
      c.map((x) => x.args),
      [['stop', id.slice(0, 8)], ['--bg', '--resume', id, '--permission-mode', 'plan', 'continue']],
    );
    assert.equal(c[1].cwd.toLowerCase(), alpha.toLowerCase());
  } finally {
    delete process.env.FAKE_CLAUDE_STOP_REMOVES;
    rmSync(file, { force: true });
  }
});

test('follow-up to a session that is not live only resumes it', async () => {
  const id = 'dddddddd-2222-4333-8444-555555555555';
  const file = makeLive(id, 'bg', 'idle');
  rmSync(file, { force: true });
  const r = await post(`/api/sessions/${id}/message`, { prompt: 'again', permissionMode: 'auto' });
  assert.equal(r.status, 200);
  assert.deepEqual(calls().map((x) => x.args), [['--bg', '--resume', id, '--permission-mode', 'auto', 'again']]);
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
  assert.deepEqual(calls().map((x) => x.args), [['--bg', '--resume', id, '--permission-mode', 'plan', 'continue here']]);
});

const auditLines = () =>
  readFileSync(join(fx.dataDir, 'commands.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);

test('follow-up to a waiting background session is refused with 409 and no CLI call', async () => {
  const id = 'eeeeeeee-2222-4333-8444-555555555555';
  const file = makeLive(id, 'bg', 'waiting');
  try {
    const r = await post(`/api/sessions/${id}/message`, { prompt: 'hi', permissionMode: 'auto' });
    assert.equal(r.status, 409);
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
    const stop = auditLines().find((l) => l.action === 'stop' && l.session === id);
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
    const r = await post(`/api/sessions/${id}/message`, { prompt: 'x', permissionMode: 'auto' });
    assert.equal(r.status, 504);
    assert.deepEqual(calls().map((x) => x.args), [['stop', id.slice(0, 8)]]);
  } finally {
    rmSync(file, { force: true });
  }
});

test('follow-up returns 502 and does not resume when stop fails and the session is still live', async () => {
  const id = '13131313-2222-4333-8444-555555555555';
  const file = makeLive(id, 'bg', 'idle');
  process.env.FAKE_CLAUDE_STOP_FAILS = '1';
  try {
    const r = await post(`/api/sessions/${id}/message`, { prompt: 'x', permissionMode: 'auto' });
    assert.equal(r.status, 502);
    assert.deepEqual(calls().map((x) => x.args), [['stop', id.slice(0, 8)]]);
    const stop = auditLines().find((l) => l.action === 'stop' && l.session === id);
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
    const r = await post(`/api/sessions/${id}/message`, { prompt: 'again', permissionMode: 'auto' });
    assert.equal(r.status, 200);
    assert.deepEqual(
      calls().map((x) => x.args),
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
    await new Promise((r) => setTimeout(r, 300)); // let the first reach the (slow) resume
    const second = await post(`/api/sessions/${id}/message`, { prompt: 'two', permissionMode: 'auto' });
    assert.equal(second.status, 409);
    assert.equal((await first).status, 200);
    const resumes = calls().filter((x) => x.args.includes('--resume'));
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
  for (const c of [start, resume]) {
    const i = c.args.indexOf('--settings');
    assert.equal(c.args[0], '--bg');
    assert.equal(i, 1);
    const settings = JSON.parse(readFileSync(c.args[i + 1], 'utf8'));
    assert.deepEqual(Object.keys(settings), ['hooks']);
    assert.deepEqual(Object.keys(settings.hooks), ['PermissionRequest']);
    assert.match(settings.hooks.PermissionRequest[0].hooks[0].command, /permission-hook\.mjs/);
    assert.ok(!JSON.stringify(settings).includes(readFileSync(join(fx.dataDir, 'hook-secret'), 'utf8').trim()), 'secret not in settings');
  }
  assert.ok(!stop.args.includes('--settings'));
});

const hookPost = (path: string, body: object, headers: Record<string, string> = {}) => {
  const host = `127.0.0.1:${port}`;
  return raw(port, { method: 'POST', path, body: JSON.stringify(body), headers: { Host: host, Origin: `http://${host}`, 'X-Dashboard': '1', 'Content-Type': 'application/json', ...headers } });
};

test('the hook endpoint needs the secret, holds the request and returns the answer', async () => {
  const secret = readFileSync(join(fx.dataDir, 'hook-secret'), 'utf8').trim();
  const req = { sessionId: SID, tool: 'Bash', toolInput: { command: 'touch x.txt' } };
  assert.equal((await hookPost('/hook/permission', req)).status, 403);
  assert.equal((await hookPost('/hook/permission', req, { 'X-Hook-Secret': 'wrong' })).status, 403);
  const held = hookPost('/hook/permission', req, { 'X-Hook-Secret': secret });
  let id = '';
  for (let i = 0; i < 50 && !id; i++) {
    await new Promise((r) => setTimeout(r, 20));
    const l = JSON.parse((await raw(port, { path: '/hook/permission', headers: { Host: `127.0.0.1:${port}`, 'X-Hook-Secret': secret } })).body).requests;
    id = l[0]?.id ?? '';
  }
  assert.ok(id);
  const st = JSON.parse((await get('/api/state')).body);
  assert.deepEqual(st.permissions.map((p: { tool: string; text: string; sessionId: string; status: string }) => [p.tool, p.text, p.sessionId, p.status]), [['Bash', 'touch x.txt', SID, 'pending']]);
  assert.ok(!JSON.stringify(st).includes(secret));
  assert.equal((await hookPost('/hook/permission/answer', { id, decision: 'deny' })).status, 403);
  assert.equal((await hookPost('/hook/permission/answer', { id, decision: 'maybe' }, { 'X-Hook-Secret': secret })).status, 400);
  assert.equal((await hookPost('/hook/permission/answer', { id, decision: 'deny' }, { 'X-Hook-Secret': secret })).status, 200);
  assert.equal(JSON.parse((await held).body).decision, 'deny');
  assert.equal((await hookPost('/hook/permission/answer', { id, decision: 'allow' }, { 'X-Hook-Secret': secret })).status, 404);
});
