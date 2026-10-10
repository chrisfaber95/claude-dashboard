// Shared fixture and auth factory for the auth test suites.
import type { IncomingMessage } from 'node:http';
import { createAuth } from '../../../src/server/auth/auth.ts';
import { createDeviceStore } from '../../../src/server/auth/devices.ts';
import { makeFixture } from '../../helpers.ts';


export const fx = makeFixture();
export const DAY = 86_400_000;
export let count = 0;
export const reqWith = (cookie?: string, extra: { host?: string; addr?: string; headers?: Record<string, string> } = {}) =>
  ({
    headers: { host: extra.host ?? '192.168.1.50:4777', ...(cookie ? { cookie } : {}), ...extra.headers },
    socket: { remoteAddress: extra.addr ?? '192.168.1.20' },
  }) as unknown as IncomingMessage;
export const sidFrom = (setCookie: string) => setCookie.split(';')[0].split('=')[1];

export function setup(now: () => number = Date.now, onFailedLogin?: (ip: string, timestampMs: number) => void) {
  const devices = createDeviceStore(`${fx.dataDir}-${count++}`, now);
  const auth = createAuth(devices, { now, onFailedLogin });
  const { id, token } = devices.create('phone');
  return { devices, auth, id, token };
}
