// Permission store, hook settings and the hook script: secret, answers, expiry and output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createPermissionStore, requestText, TEXT_MAX } from '../../../../src/server/features/permissions/permissions.ts';
// @ts-expect-error plain .mjs script without types
import { decisionOutput, runHook } from '../../../../scripts/permission-hook.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'perm-'));
const SID = '11111111-2222-4333-8444-555555555555';

test('store: secret is created once and checked; answer, expiry and abandon settle a request', async () => {
  const directory = dir();
  const permissionStore = createPermissionStore({ dataDir: directory, waitMs: 60 });
  assert.equal(permissionStore.checkSecret('nope'), false);
  assert.equal(permissionStore.checkSecret(undefined), false);
  const secret = readFileSync(permissionStore.secretPath(), 'utf8').trim();
  assert.match(secret, /^[0-9a-f]{64}$/);
  assert.equal(permissionStore.checkSecret(secret), true);
  assert.equal(readFileSync(createPermissionStore({ dataDir: directory }).secretPath(), 'utf8').trim(), secret);

  const s2 = createPermissionStore({ dataDir: directory, waitMs: 5000 });
  const response = s2.request(SID, 'Bash', 'ls')!;
  assert.deepEqual(s2.list().map((item) => [item.id, item.status]), [[response.id, 'pending']]);
  const pendingInfo = s2.list()[0];
  assert.deepEqual(s2.answer(response.id, 'allow'), { outcome: 'answered', request: { id: response.id, sessionId: SID, tool: 'Bash', text: 'ls', createdMs: pendingInfo.createdMs, status: 'pending' } });
  assert.equal(await response.outcome, 'allow');
  assert.deepEqual(s2.answer(response.id, 'deny'), { outcome: 'settled' });
  assert.deepEqual(s2.answer('00000000-0000-4000-8000-000000000000', 'deny'), { outcome: 'unknown' });
  assert.deepEqual(s2.list(), []);

  const b = permissionStore.request(SID, 'Write', 'x')!;
  assert.equal(await b.outcome, 'expired'); // waitMs elapsed
  assert.deepEqual(permissionStore.list().map((item) => item.status), ['expired']);
  assert.deepEqual(permissionStore.answer(b.id, 'allow'), { outcome: 'settled' });

  const call = s2.request(SID, 'Bash', 'y')!;
  s2.abandon(call.id);
  assert.equal(await call.outcome, 'expired');
});

test('store: settings file holds only the PermissionRequest hook and not the secret', () => {
  const permissionStore = createPermissionStore({ dataDir: dir() });
  const file = permissionStore.writeSettings('http://127.0.0.1:4777');
  const j = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(j), ['hooks']);
  assert.deepEqual(Object.keys(j.hooks), ['PermissionRequest']);
  const cmd: string = j.hooks.PermissionRequest[0].hooks[0].command;
  assert.match(cmd, /--url "http:\/\/127\.0\.0\.1:4777"/);
  assert.ok(!cmd.includes(readFileSync(permissionStore.secretPath(), 'utf8').trim()));
  assert.ok(statSync(permissionStore.secretPath()).isFile());
  // The hook runs from a copy in the data folder, not from the repo's scripts folder.
  const copy = join(dirname(file), 'permission-hook.mjs');
  assert.ok(cmd.includes(copy.replaceAll('\\', '/')));
  assert.equal(readFileSync(copy, 'utf8'), readFileSync(new URL('../../../../scripts/permission-hook.mjs', import.meta.url), 'utf8'));
});

test('requestText: command for Bash, pretty JSON otherwise, capped', () => {
  assert.equal(requestText('Bash', { command: 'touch a' }), 'touch a');
  assert.equal(requestText('Write', { file_path: 'a' }), '{\n  "file_path": "a"\n}');
  assert.equal(requestText('Bash', { command: 'x'.repeat(TEXT_MAX + 5) }).length, TEXT_MAX + 1);
});

test('hook: decision output is the documented allow / deny JSON, nothing for anything else', () => {
  assert.deepEqual(JSON.parse(decisionOutput('allow')), { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
  const deny = JSON.parse(decisionOutput('deny')).hookSpecificOutput.decision;
  assert.equal(deny.behavior, 'deny');
  assert.ok(deny.message);
  assert.equal(decisionOutput('expired'), null);
  assert.equal(decisionOutput(undefined), null);
});

async function fakeDashboard(reply: () => { status: number; body: string } | 'hang') {
  const seen: { headers: Record<string, unknown>; body: string }[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      seen.push({ headers: req.headers, body });
      const response = reply();
      if (response === 'hang') return;
      res.writeHead(response.status, { 'Content-Type': 'application/json' }).end(response.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    seen,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

function setup(url: string, extra: string[] = []) {
  const secretFile = join(dir(), 'hook-secret');
  writeFileSync(secretFile, 'sekrit\n');
  const stdin = JSON.stringify({ session_id: SID, tool_name: 'Bash', tool_input: { command: 'touch f' }, hook_event_name: 'PermissionRequest' });
  return { stdin, argv: ['--url', url, '--secret-file', secretFile, ...extra] };
}

const behavior = (out: string | null) => (out === null ? null : JSON.parse(out).hookSpecificOutput.decision.behavior);

test('hook: posts tool, input and session with the secret and prints the answer', async () => {
  const dash = await fakeDashboard(() => ({ status: 200, body: JSON.stringify({ decision: 'allow' }) }));
  const { stdin, argv } = setup(dash.url);
  const out = await runHook(stdin, argv);
  dash.close();
  assert.equal(behavior(out), 'allow');
  assert.equal(dash.seen[0].headers['x-hook-secret'], 'sekrit');
  assert.equal(dash.seen[0].headers.origin, dash.url);
  assert.deepEqual(JSON.parse(dash.seen[0].body), { sessionId: SID, tool: 'Bash', toolInput: { command: 'touch f' } });
});

test('hook: deny, expired, bad secret (403) and bad JSON give the right output', async () => {
  const cases: [{ status: number; body: string }, string | null][] = [
    [{ status: 200, body: '{"decision":"deny"}' }, 'deny'],
    [{ status: 200, body: '{"decision":"expired"}' }, null],
    [{ status: 403, body: '{"error":"forbidden"}' }, null],
    [{ status: 200, body: 'not json' }, null],
  ];
  for (const [reply, want] of cases) {
    const dash = await fakeDashboard(() => reply);
    const { stdin, argv } = setup(dash.url);
    const out = await runHook(stdin, argv);
    dash.close();
    assert.equal(behavior(out), want);
  }
});

test('hook: no decision on timeout, a dashboard that is down, bad stdin and a non-loopback url', async () => {
  const dash = await fakeDashboard(() => 'hang');
  const nowMs = setup(dash.url, ['--timeout-ms', '150']);
  assert.equal(await runHook(nowMs.stdin, nowMs.argv), null);
  dash.close();
  const down = setup(dash.url); // closed now
  assert.equal(await runHook(down.stdin, down.argv), null);
  assert.equal(await runHook('{bad', down.argv), null);
  assert.equal(await runHook(down.stdin, ['--url', 'http://example.com', '--secret-file', 'x']), null);
  assert.equal(await runHook(down.stdin, ['--url', dash.url, '--secret-file', join(dir(), 'missing')]), null);
});
