import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assistantLine, jsonl, makeFixture, raw, transcriptDir } from './helpers.ts';

// F-002 end to end: device login, QR pairing, acting as a device, the audit trail and revoke, on a real LAN-mode server.
const fx = makeFixture();
process.env.TEAM_HQ_DIR = join(fx.root, 'no-team-hq');
process.env.CLAUDE_BIN = process.execPath;
process.env.CLAUDE_BIN_ARGS = JSON.stringify([fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))]);
process.env.FAKE_CLAUDE_LOG = join(fx.root, 'cli.log');
const alpha = join(fx.projectsRoot, 'Alpha');
mkdirSync(alpha);
const SID = '11111111-2222-4333-8444-555555555555';
writeFileSync(join(transcriptDir(fx, alpha), `${SID}.jsonl`), jsonl([assistantLine({ sessionId: SID, cwd: alpha, ts: new Date().toISOString(), id: 'x' })]));
const publicDir = join(fx.root, 'public');
mkdirSync(publicDir);
writeFileSync(join(publicDir, 'index.html'), '<!doctype html><title>dash</title>');
writeFileSync(join(publicDir, 'login.html'), '<!doctype html><title>login</title>');
writeFileSync(join(publicDir, 'pair.html'), '<!doctype html><main data-state="__STATE__">Sign in as <b>__DEVICE__</b>?</main>');
// The retired shared login token, left behind on disk by an older version.
const OLD_TOKEN = 'old-shared-token-' + 'z'.repeat(30);
mkdirSync(fx.dataDir, { recursive: true });
writeFileSync(join(fx.dataDir, 'token'), OLD_TOKEN);

const { createDashboardServer } = await import('../src/server/server.ts');
const { createAuth } = await import('../src/server/auth.ts');
const { createDeviceStore } = await import('../src/server/devices.ts');
const { recordFailedSignin } = await import('../src/server/alerts.ts');
const { ensureCert } = await import('../src/server/tls.ts');

const auth = createAuth(createDeviceStore(fx.dataDir), { onFailedLogin: recordFailedSignin });
const server = createDashboardServer({ publicDir, auth, tls: ensureCert(fx.dataDir), commands: true });
let port = 0;
let lanHost = '';
let pcHost = '';

before(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
  lanHost = `192.168.1.50:${port}`; // what a phone on the LAN sends
  pcHost = `127.0.0.1:${port}`;
});
after(() => {
  server.closeAllConnections();
  server.close();
  rmSync(fx.root, { recursive: true, force: true });
});

const form = { 'Content-Type': 'application/x-www-form-urlencoded' };
const lanGet = (path: string, cookie?: string) => raw(port, { https: true, path, headers: { Host: lanHost, ...(cookie ? { Cookie: cookie } : {}) } });
const lanPost = (path: string, body: string, headers: Record<string, string> = {}) =>
  raw(port, { https: true, method: 'POST', path, body, headers: { Host: lanHost, Origin: `https://${lanHost}`, ...headers } });
const signIn = (tok: string) => lanPost('/login', `token=${encodeURIComponent(tok)}`, form);
const cookieOf = (r: { headers: Record<string, string | string[] | undefined> }) => String(r.headers['set-cookie']).split(';')[0];
function call(host: string, method: string, path: string, body?: unknown, cookie?: string) {
  return raw(port, {
    https: true,
    method,
    path,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { Host: host, ...(cookie ? { Cookie: cookie } : {}), ...(method === 'POST' ? { Origin: `https://${host}`, 'X-Dashboard': '1' } : {}) },
  });
}
const pc = (method: string, path: string, body?: unknown) => call(pcHost, method, path, body);
const device = (cookie: string, method: string, path: string, body?: unknown) => call(lanHost, method, path, body, cookie);

/** Open /api/events; resolves with the status (and a promise for the stream ending) once the first event arrives. */
function openStream(host: string, cookie?: string) {
  return new Promise<{ status: number; ended: Promise<void> }>((resolve, reject) => {
    const req = httpsRequest({ host: '127.0.0.1', port, path: '/api/events', headers: { Host: host, ...(cookie ? { Cookie: cookie } : {}) }, rejectUnauthorized: false }, (res) => {
      const ended = new Promise<void>((done) => {
        res.on('end', done);
        res.on('close', done);
        res.on('error', done);
      });
      res.once('data', () => resolve({ status: res.statusCode ?? 0, ended }));
      if (res.statusCode !== 200) resolve({ status: res.statusCode ?? 0, ended });
    });
    req.on('error', reject);
    req.end();
  });
}
const endedWithin = (p: Promise<void>, ms: number) => Promise.race([p.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), ms))]);

type Alert = { kind: string; detail: string };
type AuditRow = { action: string; device?: string; deviceId?: string; session?: string; project?: string; ok?: boolean };

test('F-002: device login, QR pairing, acting as a device, audit trail, revoke and sign-in alert', async () => {
  // 1. Without a device token nothing is served, and the retired shared token is dead.
  assert.equal((await lanGet('/')).status, 302);
  assert.equal((await lanGet('/api/state')).status, 401);
  assert.equal((await openStream(lanHost)).status, 401, 'no live event stream either');
  const old = await signIn(OLD_TOKEN);
  assert.equal(old.headers.location, '/login?e=1');
  assert.equal(old.headers['set-cookie'], undefined);

  // 2. From this PC: create a named device; the token is shown once and the device is listed.
  const made = await pc('POST', '/api/devices', { name: 'Hallway phone' });
  assert.equal(made.status, 200);
  const dev = JSON.parse(made.body) as { id: string; token: string };
  const listed = JSON.parse((await pc('GET', '/api/devices')).body).devices as Array<{ id: string; name: string }>;
  assert.equal(listed.find((d) => d.id === dev.id)?.name, 'Hallway phone');
  assert.ok(!(await pc('GET', '/api/devices')).body.includes(dev.token), 'the token is not shown again');

  // 3. Sign in by token, then by QR code; the code works once.
  const byToken = await signIn(dev.token);
  assert.equal(byToken.status, 303);
  const cookie = cookieOf(byToken);
  assert.equal((await lanGet('/api/state', cookie)).status, 200);

  const pair = JSON.parse((await pc('POST', '/api/devices/pair', { id: dev.id })).body) as { path: string };
  const code = new URL(pair.path, 'https://x').searchParams.get('c') ?? '';
  const confirm = () => lanPost('/pair', 'c=' + encodeURIComponent(code), form);
  for (let i = 0; i < 2; i++) {
    const preview = await lanGet(pair.path); // a camera app or link preview fetching the URL first
    assert.equal(preview.status, 200);
    assert.match(preview.body, /data-state="ok"/);
    assert.match(preview.body, /Sign in as <b>Hallway phone<\/b>/);
    assert.equal(preview.headers['set-cookie'], undefined);
  }
  const byQr = await confirm(); // the button
  assert.equal(byQr.status, 200);
  const qrCookie = cookieOf(byQr);
  assert.equal((await lanGet('/api/state', qrCookie)).status, 200);
  const reused = await confirm();
  assert.equal(reused.status, 401, 'the same QR code fails a second time');
  assert.equal(reused.headers['set-cookie'], undefined);

  // 4. As the device: view state, start a command, message and stop a session.
  assert.equal((await device(cookie, 'GET', '/api/state')).status, 200);
  const started = await device(cookie, 'POST', '/api/commands', { project: 'Alpha', prompt: 'hello from the hallway', permissionMode: 'plan' });
  assert.equal(started.status, 200, started.body);
  const messaged = await device(cookie, 'POST', `/api/sessions/${SID}/message`, { prompt: 'and now the tests', permissionMode: 'plan' });
  assert.equal(messaged.status, 200, messaged.body);
  const stopped = await device(cookie, 'POST', `/api/sessions/${SID}/stop`, {});
  assert.equal(stopped.status, 200, stopped.body);

  // 5. The audit trail lists each action under the device's name, and the device filter applies.
  const mine = JSON.parse((await pc('GET', `/api/audit?device=${dev.id}`)).body).entries as AuditRow[];
  const actions = mine.map((e) => e.action);
  for (const a of ['start', 'message', 'stop']) assert.ok(actions.includes(a), `${a} is audited`);
  assert.ok(mine.every((e) => e.device === 'Hallway phone' && e.deviceId === dev.id), 'only this device, under its name');
  const everything = JSON.parse((await pc('GET', '/api/audit')).body).entries as AuditRow[];
  const pcRows = JSON.parse((await pc('GET', '/api/audit?device=pc')).body).entries as AuditRow[];
  assert.ok(pcRows.length > 0 && pcRows.every((e) => e.deviceId === 'pc'));
  assert.ok(pcRows.some((e) => e.action === 'device-create') && pcRows.some((e) => e.action === 'device-pair'), 'PC actions are under "This PC"');
  assert.ok(everything.length > mine.length, 'unfiltered shows more');

  // 6. Revoke from this PC: the open stream ends, the next call is refused, the token no longer signs in.
  const stream = await openStream(lanHost, cookie);
  assert.equal(stream.status, 200);
  const revoked = await pc('POST', '/api/devices/revoke', { id: dev.id });
  assert.equal(revoked.status, 200);
  assert.equal(await endedWithin(stream.ended, 2000), true, 'the device event stream ended');
  assert.equal((await device(cookie, 'GET', '/api/state')).status, 401);
  assert.equal((await device(qrCookie, 'GET', '/api/state')).status, 401, 'the QR session ended too');
  assert.equal((await signIn(dev.token)).headers.location, '/login?e=1');

  // 7. Failed LAN sign-ins raised a needs-attention alert with a time and the source address.
  const alerts = JSON.parse((await pc('GET', '/api/state')).body).alerts.items as Alert[];
  const alert = alerts.find((a) => a.kind === 'signin');
  assert.ok(alert, 'a sign-in alert exists');
  assert.match(alert.detail, /^127[.]0[.]0[.]1 · [0-9]+ failed attempts? · last at [0-9]{2}:[0-9]{2}:[0-9]{2}$/);
  assert.ok(!JSON.stringify(alerts).includes(OLD_TOKEN) && !JSON.stringify(alerts).includes(dev.token), 'no attempted token is kept');

  // Nothing is left running or behind: the server closes in after(); the temp tree is removed there too.
  assert.ok(existsSync(fx.root));
});
