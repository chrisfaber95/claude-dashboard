import { PC_DEVICE } from '../auth/auth.ts';
import { MAX_DEVICES } from '../auth/devices.ts';
import { lanAddresses } from '../auth/tls.ts';
import { CommandError, audit } from '../claude/claude-cli.ts';
import type { AuthedCall, RouteHandler, ServerContext } from './context.ts';
import { readJson } from './request-body.ts';
import { send } from './respond.ts';

const DEVICE_PATHS = new Set(['/api/devices', '/api/devices/revoke', '/api/devices/pair']);

async function createDevice(context: ServerContext, call: AuthedCall): Promise<void> {
  const { auth } = context;
  if (!auth) return;
  const body = await readJson(call.req);
  let created: { id: string; token: string };
  try {
    created = auth.devices.create(typeof body.name === 'string' ? body.name : '');
  } catch (error) {
    const reason = error instanceof Error ? error.message : '';
    audit({ ip: call.ip, ...call.actor, action: 'device-create', ok: false });
    if (reason === 'invalid device name') throw new CommandError(400, 'invalid device name');
    if (reason === 'too many devices') throw new CommandError(409, `at most ${MAX_DEVICES} devices`);
    throw new CommandError(500, 'could not save the device');
  }
  const name = auth.devices.list().find((device) => device.id === created.id)?.name;
  audit({ ip: call.ip, ...call.actor, action: 'device-create', id: created.id, name, ok: true });
  send(call.res, 200, created);
}

async function revokeDevice(context: ServerContext, call: AuthedCall): Promise<void> {
  const { auth } = context;
  if (!auth) return;
  const body = await readJson(call.req);
  const id = typeof body.id === 'string' ? body.id : '';
  const name = auth.devices.list().find((device) => device.id === id)?.name;
  const result = auth.revokeDevice(id);
  audit({ ip: call.ip, ...call.actor, action: 'device-revoke', id: result.found ? id : undefined, name, found: result.found, persisted: result.persisted });
  if (!result.found) throw new CommandError(404, 'unknown device');
  // Sessions and streams are already ended; the file just could not be written, so it may come back after a restart.
  if (!result.persisted) throw new CommandError(500, 'device revoked, but the change could not be saved');
  send(call.res, 200, { ok: true });
}

async function createPairingLink(context: ServerContext, call: AuthedCall): Promise<void> {
  const { auth } = context;
  if (!auth) return;
  const body = await readJson(call.req);
  const id = typeof body.id === 'string' ? body.id : '';
  const pairing = auth.createPairing(id);
  audit({ ip: call.ip, ...call.actor, action: 'device-pair', id: pairing ? id : undefined, ok: pairing !== null });
  if (!pairing) throw new CommandError(404, 'unknown device');
  // The phone needs this PC's LAN address, not the loopback Host the PC used. The code is the only secret in the link.
  const path = `/pair?c=${pairing.code}`;
  const port = call.req.socket.localPort;
  const urls = port ? lanAddresses().map((address) => `${context.protocol}://${address}:${port}${path}`) : [];
  send(call.res, 200, { path, urls, expiresMs: pairing.expiresMs });
}

/** Device management: only the loopback-exempt PC, never a signed-in LAN device (decision 0003). */
export const handleDeviceRoutes: RouteHandler = async (context, call) => {
  const { url, method, who } = call;
  if (!DEVICE_PATHS.has(url.pathname)) return false;
  if (!context.auth) throw new CommandError(404, 'devices are not available');
  if (who?.deviceId !== PC_DEVICE) throw new CommandError(403, 'only this PC can manage devices');
  if (url.pathname === '/api/devices' && method === 'GET') {
    send(call.res, 200, { devices: context.auth.devices.list() });
  } else if (url.pathname === '/api/devices' && method === 'POST') {
    await createDevice(context, call);
  } else if (url.pathname === '/api/devices/revoke' && method === 'POST') {
    await revokeDevice(context, call);
  } else if (url.pathname === '/api/devices/pair' && method === 'POST') {
    await createPairingLink(context, call);
  } else {
    throw new CommandError(405, 'method not allowed');
  }
  return true;
};
