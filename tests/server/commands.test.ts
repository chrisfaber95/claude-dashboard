// Starting tasks through the Claude CLI wrapper: argument arrays, validation, launches and request guards.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assistantLine, jsonl, raw, transcriptDir } from '../helpers.ts';
import { fx, cliLog, alpha, SID, on, port, offPort, calls, post, get } from './commands-test-setup.ts';

test('starts a background task with an exact argument array in the project folder', async () => {
  const response = await post('/api/commands', { project: 'Alpha', prompt: 'list "files" & echo hacked', permissionMode: 'plan' });
  assert.equal(response.status, 200);
  const j = JSON.parse(response.body);
  assert.equal(j.ok, true);
  assert.equal(j.id, 'bg-1a2b3c');
  const [call] = calls();
  assert.deepEqual(call.args, ['--bg', '--permission-mode', 'plan', 'list "files" & echo hacked']);
  assert.equal(call.cwd.toLowerCase(), alpha.toLowerCase());
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
  const response = await post(`/api/sessions/${SID}/message`, { prompt: 'and now the tests', permissionMode: 'acceptEdits' });
  assert.equal(response.status, 200);
  const [call] = calls();
  assert.deepEqual(call.args, ['--bg', '--resume', SID, '--permission-mode', 'acceptEdits', 'and now the tests']);
  assert.equal(call.cwd.toLowerCase(), alpha.toLowerCase());
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
  const lines = readFileSync(join(fx.dataDir, 'commands.log'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
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
  const response = await post('/api/commands', { project: 'Alpha', goal: ' Fix the login bug ', notes: '\nIt only fails on Safari.\n', permissionMode: 'plan' });
  assert.equal(response.status, 200);
  const j = JSON.parse(response.body);
  assert.equal(j.ok, true);
  assert.equal(j.started, true);
  assert.deepEqual(calls()[0].args, ['--bg', '--permission-mode', 'plan', '## Goal\nFix the login bug\n\n## Background notes\nIt only fails on Safari.']);
});

test('empty notes add no notes section; a goal starting with - is still neutralised', async () => {
  await post('/api/commands', { project: 'Alpha', goal: 'Do it', notes: '  \n ' });
  await post('/api/commands', { project: 'Alpha', goal: '--help' });
  await post('/api/commands', { project: 'Alpha', prompt: 'old field' });
  assert.deepEqual(calls().map((call) => call.args[3]), ['Do it', 'Task:\n--help', 'old field']);
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
    const response = await post('/api/commands', body);
    assert.equal(response.status, 400, JSON.stringify(body).slice(0, 60));
    assert.equal(JSON.parse(response.body).error, error);
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
  const response = await get('/api/launches');
  assert.equal(response.status, 200);
  const { launches } = JSON.parse(response.body) as { launches: Array<Record<string, unknown>> };
  assert.equal(launches.length, 50);
  assert.deepEqual(launches.slice(0, 2).map((launch) => launch.goal), ['goal 51', 'goal 50']);
  assert.ok(launches.every((launch) => launch.action === 'start'));
  assert.deepEqual(launches[0], {
    ts: launches[0].ts, action: 'start', device: 'This PC', deviceId: 'pc', project: 'Alpha', session: 'bg-1a2b3c', mode: 'plan', ok: true, goal: 'goal 51', notesLength: 3,
  });
  assert.equal((await post('/api/launches', {})).status, 404);
});

test('serves the transcript of a known session and rejects bad ids', async () => {
  const response = await get(`/api/sessions/${SID}/transcript`);
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body).entries.map((entry: { role: string }) => entry.role), ['assistant']);
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
  const response = await post(`/api/sessions/${OUT}/message`, { prompt: 'x', permissionMode: 'auto' });
  assert.equal(response.status, 403);
  assert.equal(calls().length, 0);
  assert.equal((await get(`/api/sessions/${OUT}/transcript`)).status, 200, 'viewing is still allowed');
});

test('cross-site GETs cannot spawn the CLI', async () => {
  const response = await raw(port, { path: '/api/sessions/bg-1a2b3c/logs', headers: { Host: `127.0.0.1:${port}`, 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(response.status, 403);
  assert.equal(calls().length, 0);
});
