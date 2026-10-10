import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { rmSync } from 'node:fs';
import { join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_ROOT, canRunCommands, DATA_DIR, HOST, isLanMode, PORT, PROJECTS_ROOT } from './config.ts';
import { recordFailedSignin } from './features/alerts/alerts.ts';
import { APPROVAL_TEXT_AUDIT_MAX, createPermissionStore, type PermissionStore } from './features/permissions/permissions.ts';
import { PC_DEVICE, createAuth, type Auth } from './auth/auth.ts';
import { isLocalPeer } from './auth/loopback.ts';
import { createDeviceStore } from './auth/devices.ts';
import { CommandError, audit } from './claude/claude-cli.ts';
import { buildState } from './transcripts/state.ts';
import { ensureCert, lanAddresses } from './auth/tls.ts';
import type { Actor, AuthedCall, RequestCall, RouteHandler, ServerContext } from './http/context.ts';
import { PUBLIC_PATHS, SECURITY_HEADERS, findGuardRejection } from './http/guards.ts';
import { createLiveStreams } from './http/live-streams.ts';
import { handleCommandRoutes } from './http/routes-commands.ts';
import { handleDeviceRoutes } from './http/routes-devices.ts';
import { handleLoginRoutes, handleLogout } from './http/routes-login.ts';
import { handlePermissionHook } from './http/routes-permission-hook.ts';
import { handlePermissionRoutes } from './http/routes-permissions.ts';
import { handleSessionRoutes } from './http/routes-sessions.ts';
import { handleSettingsRoutes } from './http/routes-settings.ts';
import { handleStateRoutes } from './http/routes-state.ts';
import { send } from './http/respond.ts';
import { handleStaticRoute } from './http/static-files.ts';

const PUBLIC_DIR = join(APP_ROOT, 'public');
/** How often open event streams get a fresh state and expired sessions are swept. */
const STREAM_TICK_MS = 2000;
/** API routes in the order they are tried; the first that answers wins. */
const API_ROUTES: RouteHandler[] = [
  handleStateRoutes,
  handleSessionRoutes,
  handleDeviceRoutes,
  handleSettingsRoutes,
  handleCommandRoutes,
  handlePermissionRoutes,
];

/** Options for the dashboard server; tests inject their own. */
export interface ServerOptions {
  publicDir?: string;
  /** Login required when set (LAN mode). */
  auth?: Auth | null;
  tls?: { key: Buffer; cert: Buffer } | null;
  commands?: boolean;
  projectsRoot?: string;
  /** Permission-prompt store (tests inject one). */
  permissions?: PermissionStore;
  /** Whether a request's socket peer is this PC (tests replace it: every test client connects from loopback). */
  isLocalPeer?: (req: IncomingMessage) => boolean;
}

/** Who is acting, for the audit log. Without a login (localhost mode) the caller is this PC. */
function describeActor(context: ServerContext, deviceId: string | undefined): Actor {
  if (deviceId === undefined || deviceId === PC_DEVICE) return { deviceId: deviceId ?? PC_DEVICE, device: 'This PC' };
  const name = context.auth?.devices.list().find((device) => device.id === deviceId)?.name;
  return { deviceId, device: name ?? deviceId };
}

/** Run the guards and routes in their fixed order; the order is part of the security model. */
async function handle(context: ServerContext, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { auth } = context;
  const url = new URL(req.url ?? '/', `${context.protocol}://localhost`);
  const method = req.method ?? 'GET';
  const ip = req.socket.remoteAddress ?? 'unknown';
  const call: RequestCall = { req, res, url, method, ip };

  const rejection = findGuardRejection({ req, pathname: url.pathname, method, protocol: context.protocol, isLoginRequired: Boolean(auth) });
  if (rejection) {
    send(res, rejection.status, { error: rejection.error });
    return;
  }
  // Both sit before the identify gate: the hook has no device session and a visitor has no login yet.
  if (await handlePermissionHook(context, call)) return;
  if (await handleLoginRoutes(context, call)) return;

  // LAN mode: a device session, or this PC (loopback socket and loopback Host).
  const who = auth ? auth.identify(req) : null;
  if (auth && !PUBLIC_PATHS.has(url.pathname) && !who) {
    if (url.pathname.startsWith('/api/')) send(res, 401, { error: 'login required' });
    else res.writeHead(302, { Location: '/login', ...SECURITY_HEADERS }).end();
    return;
  }
  const authedCall: AuthedCall = { ...call, who, actor: describeActor(context, who?.deviceId) };

  // Sliding session: the cookie is re-issued at most once a day.
  if (auth && who?.refreshSid) res.setHeader('Set-Cookie', auth.cookie(who.refreshSid, context.isTlsEnabled));

  if (await handleLogout(context, authedCall)) return;
  for (const route of API_ROUTES) {
    if (await route(context, authedCall)) return;
  }
  await handleStaticRoute(context, authedCall);
}

/** Create the dashboard HTTP(S) server; it does not listen until the caller does. */
export function createDashboardServer(options: ServerOptions = {}): Server {
  const auth = options.auth ?? null;
  const tls = options.tls ?? null;
  const isCommandsEnabled = options.commands ?? canRunCommands;
  const permissions = options.permissions ?? createPermissionStore();
  // Expiry has no device behind it; answers are audited by the route that takes them.
  permissions.onExpired((request) =>
    audit({ action: 'approval', outcome: 'expired', id: request.id, session: request.sessionId, tool: request.tool, text: request.text.slice(0, APPROVAL_TEXT_AUDIT_MAX) }),
  );
  const streams = createLiveStreams(auth);
  let settingsFile: string | undefined;
  const context: ServerContext = {
    publicDir: normalize(options.publicDir ?? PUBLIC_DIR),
    auth,
    protocol: tls ? 'https' : 'http',
    isTlsEnabled: Boolean(tls),
    areCommandsEnabled: isCommandsEnabled,
    projectsRoot: options.projectsRoot ?? PROJECTS_ROOT,
    permissions,
    isLocalPeer: options.isLocalPeer ?? isLocalPeer,
    streams,
    buildDashboardState: () => ({ ...buildState({ lan: Boolean(auth), commands: isCommandsEnabled }), permissions: permissions.list() }),
    getSettingsFile: () => settingsFile,
  };

  const listener = (req: IncomingMessage, res: ServerResponse) => {
    handle(context, req, res).catch((error) => {
      if (res.headersSent) return res.end();
      if (error instanceof CommandError) send(res, error.status, { error: error.message });
      else send(res, 500, { error: 'internal error' });
    });
  };
  const server: Server = tls ? createHttpsServer({ key: tls.key, cert: tls.cert }, listener) : createHttpServer(listener);

  const timer = setInterval(() => {
    // An open stream makes no requests, so an expired session is noticed here.
    auth?.sweepExpired();
    if (streams.count() > 0) streams.broadcast(context.buildDashboardState());
  }, STREAM_TICK_MS);
  server.on('listening', () => {
    const address = server.address();
    if (!isCommandsEnabled || !address || typeof address === 'string') return;
    try {
      settingsFile = permissions.writeSettings(`${context.protocol}://127.0.0.1:${address.port}`);
    } catch {
      // no settings file: sessions then start without the hook and prompt normally
    }
  });
  server.on('close', () => {
    clearInterval(timer);
    streams.closeAll();
  });

  return server;
}

/** Startup address lines. LAN mode splits "this PC, no login" from the addresses other devices sign in on. */
export function startupLines(isLanMode: boolean, host: string, port: number, lanHosts: string[]): string[] {
  if (!isLanMode) return [`Claude dashboard on http://${host}:${port}`];
  const lines = [`Claude dashboard, this PC (no login): https://localhost:${port}`];
  const others = host === '0.0.0.0' || host === '::' ? lanHosts : [host];
  for (const otherHost of others) lines.push(`Claude dashboard, other devices (sign in with a device token): https://${otherHost}:${port}`);
  return lines;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let options: ServerOptions = {};
  // The old shared login token is no longer read; remove the leftover secret.
  rmSync(join(DATA_DIR, 'token'), { force: true });
  if (isLanMode) {
    // Failed sign-ins become one needs-attention alert per source address.
    options = { auth: createAuth(createDeviceStore(DATA_DIR), { onFailedLogin: recordFailedSignin }), tls: ensureCert(DATA_DIR) };
    console.log('Sign-in uses per-device tokens; this PC (loopback address) needs none.');
  }
  createDashboardServer(options).listen(PORT, HOST, () => {
    for (const line of startupLines(isLanMode, HOST, PORT, lanAddresses())) console.log(line);
    console.log(`Commands ${canRunCommands ? 'enabled' : 'disabled'}${isLanMode ? ' · login required' : ''}`);
  });
}
