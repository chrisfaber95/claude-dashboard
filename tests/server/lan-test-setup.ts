// Shared LAN-mode server, fake CLI and request helpers for the LAN test suites.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFixture, raw } from '../helpers.ts';


export const fx = makeFixture();
// Never read the real team-hq board: a ticket in review would add alerts.
process.env.TEAM_HQ_DIR = join(fx.root, 'no-team-hq');
// A fake Claude CLI, so a signed-in device can start a task and the audit log gets a real entry.
process.env.CLAUDE_BIN = process.execPath;
process.env.CLAUDE_BIN_ARGS = JSON.stringify([fileURLToPath(new URL('../fake-claude.mjs', import.meta.url))]);
process.env.FAKE_CLAUDE_LOG = join(fx.root, 'cli.log');
mkdirSync(join(fx.projectsRoot, 'Alpha'));
export const publicDir = join(fx.root, 'public');
mkdirSync(publicDir);
writeFileSync(join(publicDir, 'index.html'), '<!doctype html><title>dash</title>');
writeFileSync(join(publicDir, 'login.html'), '<!doctype html><title>login</title>');
writeFileSync(join(publicDir, 'pair.html'), '<!doctype html><main data-state="__STATE__">Sign in as <b>__DEVICE__</b>?</main>');
writeFileSync(join(publicDir, 'style.css'), 'body{}');
writeFileSync(join(fx.root, 'secret.txt'), 'nope');

export const { createDashboardServer } = await import('../../src/server/server.ts');
export const { createAuth } = await import('../../src/server/auth/auth.ts');
export const { createDeviceStore } = await import('../../src/server/auth/devices.ts');
export const { recordFailedSignin } = await import('../../src/server/features/alerts/alerts.ts');
export const { ensureCert } = await import('../../src/server/auth/tls.ts');

export const devices = createDeviceStore(fx.dataDir);
export const { token, id: deviceId } = devices.create('test phone');
// The same wiring as the real server, with a clock the expiry test can move forward.
export const clock = { skew: 0 };
export const auth = createAuth(devices, { onFailedLogin: recordFailedSignin, now: () => Date.now() + clock.skew });
export const server = createDashboardServer({ publicDir, auth, tls: ensureCert(fx.dataDir), commands: true });
export let port = 0;
export let host = '';

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  host = `192.168.1.50:${port}`; // what a phone on the LAN would send
});
after(() => {
  server.closeAllConnections();
  server.close();
});

export const get = (path: string, headers: Record<string, string> = {}) => raw(port, { https: true, path, headers: { Host: host, ...headers } });
export const post = (path: string, body: string, headers: Record<string, string> = {}) =>
  raw(port, { https: true, method: 'POST', path, body, headers: { Host: host, Origin: `https://${host}`, ...headers } });

export function openStream(headers: Record<string, string>) {
  return new Promise<{ status: number; ended: Promise<void>; first: string }>((resolve, reject) => {
    const req = httpsRequest({ host: '127.0.0.1', port, path: '/api/events', headers, rejectUnauthorized: false }, (res) => {
      const ended = new Promise<void>((done) => {
        res.on('end', done);
        res.on('close', done);
        res.on('error', done);
      });
      let first = '';
      res.on('data', (chunk) => {
        if (first.includes('"manageDevices"')) return;
        first += String(chunk);
        if (first.includes('"manageDevices"')) resolve({ status: res.statusCode ?? 0, ended, first });
      });
      if (res.statusCode !== 200) resolve({ status: res.statusCode ?? 0, ended, first });
    });
    req.on('error', reject);
    req.end();
  });
}

export const settled = (promise: Promise<void>) => Promise.race([promise.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 700))]);
export const form = { 'Content-Type': 'application/x-www-form-urlencoded' };

/** Strings go out as they are, objects as JSON, and no body stays undefined. */
function serializeBody(body: unknown): string | undefined {
  if (body === undefined) return undefined;
  return typeof body === 'string' ? body : JSON.stringify(body);
}
export const pcHost = () => `127.0.0.1:${port}`;
/** A request from this PC: loopback socket + loopback Host, so it is the exempt `pc` and needs no login. */
export function pcCall(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return raw(port, {
    https: true,
    method,
    path,
    body: serializeBody(body),
    headers: { Host: pcHost(), ...(method === 'POST' ? { Origin: `https://${pcHost()}`, 'X-Dashboard': '1' } : {}), ...headers },
  });
}
/** The same call as a signed-in LAN device (non-loopback Host). */
export function deviceCall(cookieValue: string, method: string, path: string, body?: unknown) {
  return raw(port, {
    https: true,
    method,
    path,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { Host: host, Cookie: cookieValue, ...(method === 'POST' ? { Origin: `https://${host}`, 'X-Dashboard': '1' } : {}) },
  });
}
export async function signInDevice(tok: string): Promise<string> {
  const response = await post('/login', `token=${encodeURIComponent(tok)}`, form);
  assert.equal(response.status, 303);
  return String(response.headers['set-cookie']).split(';')[0];
}

export const newDevice = async (name: string) => {
  let response = await pcCall('POST', '/api/devices', { name });
  if (response.status === 409) {
    for (const device of JSON.parse((await pcCall('GET', '/api/devices')).body).devices as Array<{ id: string; name: string }>) {
      if (device.name.startsWith('filler')) await pcCall('POST', '/api/devices/revoke', { id: device.id });
    }
    response = await pcCall('POST', '/api/devices', { name });
  }
  assert.equal(response.status, 200, response.body);
  return JSON.parse(response.body) as { id: string; token: string };
};
export const formHdr = { 'Content-Type': 'application/x-www-form-urlencoded' };
/** What the confirm page's button does: POST the code from the link. */
export const confirm = (path: string) => post('/pair', 'c=' + encodeURIComponent(new URL(path, 'https://x').searchParams.get('c') ?? ''), formHdr);
export const pairOf = async (id: string) => JSON.parse((await pcCall('POST', '/api/devices/pair', { id })).body) as { path: string; urls: string[]; expiresMs: number };
