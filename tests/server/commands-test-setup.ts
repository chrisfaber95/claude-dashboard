// Shared servers, fake CLI wiring and request helpers for the commands test suites.
import { after, before, beforeEach, test } from 'node:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assistantLine, jsonl, makeFixture, raw, transcriptDir } from '../helpers.ts';


export const fx = makeFixture();
export const cliLog = join(fx.root, 'cli.log');
process.env.CLAUDE_BIN = process.execPath;
process.env.CLAUDE_BIN_ARGS = JSON.stringify([fileURLToPath(new URL('../fake-claude.mjs', import.meta.url))]);
process.env.FAKE_CLAUDE_LOG = cliLog;

export const alpha = join(fx.projectsRoot, 'Alpha');
mkdirSync(alpha);
mkdirSync(join(fx.projectsRoot, 'Untrusted'));
export const SID = '11111111-2222-4333-8444-555555555555';
writeFileSync(join(transcriptDir(fx, alpha), `${SID}.jsonl`), jsonl([assistantLine({ sessionId: SID, cwd: alpha, ts: new Date().toISOString(), id: 'x' })]));

export const publicDir = join(fx.root, 'public');
mkdirSync(publicDir);
export const { createDashboardServer } = await import('../../src/server/server.ts');
export const { createPermissionStore } = await import('../../src/server/features/permissions/permissions.ts');
export const { createAuth } = await import('../../src/server/auth/auth.ts');
export const { createDeviceStore } = await import('../../src/server/auth/devices.ts');
export const sharedPermissions = createPermissionStore();
export const on = createDashboardServer({ publicDir, commands: true, permissions: sharedPermissions });
export const off = createDashboardServer({ publicDir, commands: false });
// A LAN-mode server sharing the pending store with `on`: the only place a permission request can be answered.
export const devices = createDeviceStore(join(fx.root, 'lan-devices'));
export const lanAuth = createAuth(devices);
export const phone = devices.create('phone');
export const phoneSid = lanAuth.login('192.168.1.20', phone.token) as string;
// Test clients all connect from loopback, so a request counts as "from a remote peer" when it carries a LAN Host.
export const remotePeer = (req: IncomingMessage) => !req.headers.host?.startsWith('127.0.0.1');
export const lan = createDashboardServer({ publicDir, commands: true, permissions: sharedPermissions, auth: lanAuth, isLocalPeer: (req) => !remotePeer(req) });
// Same server with the real peer check: every test client is local, so nobody can answer.
export const lanStrict = createDashboardServer({ publicDir, commands: true, permissions: sharedPermissions, auth: lanAuth });
export let port = 0;
export let offPort = 0;
export let lanPort = 0;
export let lanStrictPort = 0;

before(async () => {
  await new Promise<void>((resolve) => on.listen(0, '127.0.0.1', resolve));
  await new Promise<void>((resolve) => off.listen(0, '127.0.0.1', resolve));
  await new Promise<void>((resolve) => lan.listen(0, '127.0.0.1', resolve));
  await new Promise<void>((resolve) => lanStrict.listen(0, '127.0.0.1', resolve));
  lanPort = (lan.address() as AddressInfo).port;
  lanStrictPort = (lanStrict.address() as AddressInfo).port;
  port = (on.address() as AddressInfo).port;
  offPort = (off.address() as AddressInfo).port;
});
after(() => {
  for (const server of [on, off, lan, lanStrict]) {
    server.closeAllConnections();
    server.close();
  }
});
beforeEach(() => rmSync(cliLog, { force: true }));

export const rawCalls = () =>
  existsSync(cliLog) ? readFileSync(cliLog, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { args: string[]; cwd: string }) : [];
/** Calls without the dashboard's own `--settings <file>` pair, which has its own test. */
export const calls = () =>
  rawCalls().map((rawCall) => {
    const i = rawCall.args.indexOf('--settings');
    return i < 0 ? rawCall : { ...rawCall, args: rawCall.args.filter((_, j) => j !== i && j !== i + 1) };
  });

export function post(path: string, body: object, targetPort = port) {
  const host = `127.0.0.1:${targetPort}`;
  return raw(targetPort, {
    method: 'POST',
    path,
    body: JSON.stringify(body),
    headers: { Host: host, Origin: `http://${host}`, 'X-Dashboard': '1', 'Content-Type': 'application/json' },
  });
}
export const get = (path: string, targetPort = port) => raw(targetPort, { path, headers: { Host: `127.0.0.1:${targetPort}` } });
