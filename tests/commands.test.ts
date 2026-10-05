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

const calls = () =>
  existsSync(cliLog) ? readFileSync(cliLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { args: string[]; cwd: string }) : [];

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
  assert.deepEqual(calls()[0].args, ['stop', SID]);
  const logs = JSON.parse((await get(`/api/sessions/bg-1a2b3c/logs`)).body);
  assert.equal(logs.output, 'line one\nline two');
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
  assert.equal(last.prompt, 'audit me');
  assert.equal(last.ok, true);
  assert.ok(last.ip);
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
