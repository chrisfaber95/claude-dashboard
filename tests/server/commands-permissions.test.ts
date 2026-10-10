// Permission prompts answered from the dashboard: the hook endpoint, answering rules and expiry.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { raw } from '../helpers.ts';
import { fx, SID, publicDir, createDashboardServer, createPermissionStore, devices, phone, phoneSid, port, offPort, lanPort, lanStrictPort, get } from './commands-test-setup.ts';

const hookPost = (path: string, body: object, headers: Record<string, string> = {}) => {
  const host = `127.0.0.1:${port}`;
  return raw(port, { method: 'POST', path, body: JSON.stringify(body), headers: { Host: host, Origin: `http://${host}`, 'X-Dashboard': '1', 'Content-Type': 'application/json', ...headers } });
};

/** Submits a request through the hook endpoint and returns the id once it shows as pending in the state. */
async function holdRequest(secret: string, text: string) {
  const held = hookPost('/hook/permission', { sessionId: SID, tool: 'Bash', toolInput: { command: text } }, { 'X-Hook-Secret': secret });
  for (let i = 0; i < 50; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    const found = JSON.parse((await get('/api/state')).body).permissions.find((permission: { text: string }) => permission.text === text.slice(0, 4000));
    if (found) return { id: found.id as string, held };
  }
  throw new Error('request never became pending');
}
const readSecret = () => readFileSync(join(fx.dataDir, 'hook-secret'), 'utf8').trim();
/** From this PC: loopback socket and loopback Host, browser-looking headers. Never allowed to answer. */
const answerFromPc = (id: string, body: object, targetPort = lanPort, headers: Record<string, string> = {}) => {
  const host = `127.0.0.1:${targetPort}`;
  return raw(targetPort, { method: 'POST', path: `/api/permissions/${id}`, body: JSON.stringify(body), headers: { Host: host, Origin: `http://${host}`, 'X-Dashboard': '1', 'Content-Type': 'application/json', ...headers } });
};
/** From a paired device (a LAN Host and its session cookie). */
const answer = (id: string, body: object, targetPort = lanPort, headers: Record<string, string> = {}) => {
  const host = `192.168.1.50:${targetPort}`;
  return raw(targetPort, { method: 'POST', path: `/api/permissions/${id}`, body: JSON.stringify(body), headers: { Host: host, Origin: `http://${host}`, 'X-Dashboard': '1', 'Content-Type': 'application/json', Cookie: `dash_sid=${phoneSid}`, ...headers } });
};
const isPending = async (id: string) => JSON.parse((await get('/api/state')).body).permissions.some((permission: { id: string }) => permission.id === id);

test('the hook endpoint needs the secret, holds the request and cannot answer it', async () => {
  const secret = readSecret();
  const req = { sessionId: SID, tool: 'Bash', toolInput: { command: 'touch x.txt' } };
  assert.equal((await hookPost('/hook/permission', req)).status, 403);
  assert.equal((await hookPost('/hook/permission', req, { 'X-Hook-Secret': 'wrong' })).status, 403);
  const { id, held } = await holdRequest(secret, 'touch x.txt');
  const state = JSON.parse((await get('/api/state')).body);
  assert.ok(!JSON.stringify(state).includes(secret));
  // No self-approval: the secret opens no answer route, and the old answer and list routes are gone.
  const old = await hookPost('/hook/permission/answer', { id, decision: 'allow' }, { 'X-Hook-Secret': secret });
  assert.notEqual(old.status, 200);
  assert.equal((await raw(port, { path: '/hook/permission', headers: { Host: `127.0.0.1:${port}`, 'X-Hook-Secret': secret } })).status, 405);
  assert.ok(JSON.parse((await get('/api/state')).body).permissions.some((permission: { id: string }) => permission.id === id), 'still pending');
  assert.equal((await answer(id, { decision: 'deny' })).status, 200);
  assert.equal(JSON.parse((await held).body).decision, 'deny');
});

test('POST /api/permissions/:id answers once, audits it and lists it in /api/approvals', async () => {
  const secret = readSecret();
  const { id, held } = await holdRequest(secret, 'echo ' + 'y'.repeat(700));
  assert.equal((await answer(id, { decision: 'always' })).status, 400);
  assert.equal((await answer(id, { decision: 'bypass' })).status, 400);
  assert.ok(JSON.parse((await get('/api/state')).body).permissions.some((permission: { id: string }) => permission.id === id), 'still pending after refusals');
  assert.equal((await answer(id, { decision: 'allow' })).status, 200);
  assert.equal(JSON.parse((await held).body).decision, 'allow');
  const again = await answer(id, { decision: 'deny' });
  assert.equal(again.status, 409);
  assert.equal(JSON.parse(again.body).error, 'permission request already answered or expired');
  assert.equal((await answer('00000000-0000-4000-8000-000000000000', { decision: 'allow' })).status, 404);
  assert.equal((await answer('not-an-id', { decision: 'allow' })).status, 404);

  const { approvals } = JSON.parse((await get('/api/approvals')).body);
  assert.deepEqual([approvals[0].action, approvals[0].outcome, approvals[0].session, approvals[0].tool], ['approval', 'allow', SID, 'Bash']);
  assert.equal(approvals[0].text.length, 500);
  assert.ok(approvals[0].ts && approvals[0].device);
  assert.ok(!JSON.stringify(approvals).includes(secret));
});

test('answering needs the same guards and enabled commands; a refused answer leaves the request pending', async () => {
  const secret = readSecret();
  const { id, held } = await holdRequest(secret, 'rm -rf guarded');
  const host = `192.168.1.50:${lanPort}`;
  const send = (headers: Record<string, string>) =>
    raw(lanPort, { method: 'POST', path: `/api/permissions/${id}`, body: JSON.stringify({ decision: 'allow' }), headers: { Host: host, Cookie: `dash_sid=${phoneSid}`, 'Content-Type': 'application/json', ...headers } });
  assert.equal((await send({ Origin: 'http://evil.example', 'X-Dashboard': '1' })).status, 403);
  assert.equal((await send({ Origin: `http://${host}` })).status, 403);
  assert.equal((await send({ Origin: `http://${host}`, 'X-Dashboard': '1', 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await raw(lanPort, { method: 'POST', path: `/api/permissions/${id}`, body: '{"decision":"allow"}', headers: { Host: host, Origin: `http://${host}`, 'X-Dashboard': '1' } })).status, 401, 'no session');
  assert.equal((await answer(id, { decision: 'allow' }, lanPort, { Cookie: 'dash_sid=forged' })).status, 401);
  assert.equal((await answerFromPc(id, { decision: 'allow' }, offPort)).status, 404, 'commands disabled');
  assert.ok(await isPending(id));
  assert.equal((await answer(id, { decision: 'deny' })).status, 200);
  await held;
});

test('an unanswered request is audited as expired', async () => {
  const shortLived = createDashboardServer({ publicDir, commands: true, permissions: createPermissionStore({ dataDir: fx.dataDir, waitMs: 60 }) });
  await new Promise<void>((resolve) => shortLived.listen(0, '127.0.0.1', resolve));
  const shortPort = (shortLived.address() as AddressInfo).port;
  try {
    const host = `127.0.0.1:${shortPort}`;
    const reply = await raw(shortPort, {
      method: 'POST',
      path: '/hook/permission',
      body: JSON.stringify({ sessionId: SID, tool: 'Write', toolInput: { file_path: 'a' } }),
      headers: { Host: host, Origin: `http://${host}`, 'X-Dashboard': '1', 'X-Hook-Secret': readSecret(), 'Content-Type': 'application/json' },
    });
    assert.equal(JSON.parse(reply.body).decision, 'expired');
    const { approvals } = JSON.parse((await get('/api/approvals', shortPort)).body);
    assert.deepEqual([approvals[0].outcome, approvals[0].tool, approvals[0].session, approvals[0].device], ['expired', 'Write', SID, undefined]);
  } finally {
    shortLived.closeAllConnections();
    shortLived.close();
  }
});

test('only a paired device may answer: a forged answer from this PC is refused and the request stays pending', async () => {
  const { id, held } = await holdRequest(readSecret(), 'touch forged.txt');
  const forged = await answerFromPc(id, { decision: 'allow' });
  assert.equal(forged.status, 403);
  assert.equal(JSON.parse(forged.body).error, 'answering needs a paired device');
  // Even with the hook secret in the headers and the loopback exemption in a server without login.
  assert.equal((await answerFromPc(id, { decision: 'allow' }, lanPort, { 'X-Hook-Secret': readSecret() })).status, 403);
  assert.equal((await answerFromPc(id, { decision: 'allow' }, port)).status, 403, 'localhost mode has no paired device');
  assert.equal((await answerFromPc(id, { decision: 'deny' }, lanPort, { Cookie: `dash_sid=${phoneSid}` })).status, 403, 'a paired cookie sent from the PC is still the PC');
  assert.ok(await isPending(id));
  assert.equal((await answer(id, { decision: 'deny' })).status, 200);
  assert.equal(JSON.parse((await held).body).decision, 'deny');
  const { approvals } = JSON.parse((await get('/api/approvals')).body);
  assert.equal(approvals[0].device, 'phone');
  assert.equal(approvals[0].outcome, 'deny');
  assert.ok(approvals.every((a: { outcome: string; device?: string }) => a.outcome !== 'allow' || a.device === 'phone'), 'no approval is attributed to this PC');
});

test('a device minted from this PC cannot answer: the real peer check refuses a forged LAN Host', async () => {
  const { id, held } = await holdRequest(readSecret(), 'touch minted.txt');
  // The chain a session on this PC could try: create a device over loopback, log in, answer with a LAN Host.
  const host = `127.0.0.1:${lanStrictPort}`;
  const lanHost = `192.168.1.50:${lanStrictPort}`;
  const minted = await raw(lanStrictPort, { method: 'POST', path: '/api/devices', body: JSON.stringify({ name: 'minted' }), headers: { Host: host, Origin: `http://${host}`, 'X-Dashboard': '1', 'Content-Type': 'application/json' } });
  assert.equal(minted.status, 200);
  const { token } = JSON.parse(minted.body);
  const login = await raw(lanStrictPort, { method: 'POST', path: '/login', body: `token=${token}`, headers: { Host: lanHost, Origin: `http://${lanHost}`, 'Content-Type': 'application/x-www-form-urlencoded' } });
  const cookie = String(login.headers['set-cookie']).split(';')[0];
  assert.match(cookie, /^dash_sid=/);
  const forged = await raw(lanStrictPort, { method: 'POST', path: `/api/permissions/${id}`, body: '{"decision":"allow"}', headers: { Host: lanHost, Origin: `http://${lanHost}`, 'X-Dashboard': '1', 'Content-Type': 'application/json', Cookie: cookie } });
  assert.equal(forged.status, 403);
  assert.ok(await isPending(id));
  assert.equal((await answer(id, { decision: 'deny' })).status, 200);
  await held;
});
