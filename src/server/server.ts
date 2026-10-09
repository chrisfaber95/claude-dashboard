import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readdirSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_ROOT, COMMANDS_ENABLED, DATA_DIR, HOST, LAN_MODE, PORT, PROJECTS_ROOT, UUID_RE, normPath } from './config.ts';
import { dismissAlert, recordFailedSignin, setAlertThreshold } from './alerts.ts';
import { readAudit } from './audit-log.ts';
import { PC_DEVICE, createAuth, type Auth } from './auth.ts';
import { MAX_DEVICES, createDeviceStore } from './devices.ts';
import {
  CommandError,
  audit,
  continueSession,
  sessionLogs,
  startTask,
  stopSession,
  validateMode,
  validatePrompt,
} from './claude-cli.ts';
import { buildState, readSessions } from './state.ts';
import { ensureCert, lanAddresses } from './tls.ts';
import { summarize } from './session-summary.ts';
import { readTranscriptPage } from './transcript-view.ts';
import { scanTranscripts, subagentPaths, transcriptIndex } from './transcripts.ts';

const PUBLIC_DIR = join(APP_ROOT, 'public');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};
/** Reachable without a login session. */
const PUBLIC_PATHS = new Set(['/login', '/login.js', '/style.css', '/pair']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const BODY_MAX = 64 * 1024;
/** Session ids with a follow-up in flight. */
const continuing = new Set<string>();

export interface ServerOptions {
  publicDir?: string;
  /** Login required when set (LAN mode). */
  auth?: Auth | null;
  tls?: { key: Buffer; cert: Buffer } | null;
  commands?: boolean;
  projectsRoot?: string;
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  // same-origin (not no-referrer): no-referrer makes browsers send "Origin: null" on form POSTs.
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; form-action 'self'; base-uri 'none'",
};

/** Hostname from the Host header itself (an absolute-form request target must not override it). */
function hostnameOf(host: string): string {
  if (host.startsWith('[')) return host.slice(0, host.indexOf(']') + 1);
  return host.split(':')[0].toLowerCase();
}

/** A session folder is only usable for commands if it lies inside one of the listed projects. */
function insideProject(cwd: string, root: string): boolean {
  const n = normPath(cwd);
  return projectNames(root).some((name) => {
    const p = normPath(join(root, name));
    return n === p || n.startsWith(p + '\\');
  });
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooBig = false;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > BODY_MAX) tooBig = true;
      else chunks.push(c);
    });
    // Drain the whole body before answering so the client actually receives the 413.
    req.on('end', () => (tooBig ? reject(new CommandError(413, 'request body too large')) : resolve(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', reject);
  });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  try {
    const v = JSON.parse(await readBody(req));
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  } catch (e) {
    if (e instanceof CommandError) throw e;
  }
  throw new CommandError(400, 'expected a JSON object');
}

function projectNames(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
  } catch {
    return [];
  }
}

export function createDashboardServer(opts: ServerOptions = {}): Server {
  const publicDir = normalize(opts.publicDir ?? PUBLIC_DIR);
  const auth = opts.auth ?? null;
  const tls = opts.tls ?? null;
  const commands = opts.commands ?? COMMANDS_ENABLED;
  const projectsRoot = opts.projectsRoot ?? PROJECTS_ROOT;
  const proto = tls ? 'https' : 'http';
  /**
   * Open live-event streams with the device and the session each was opened with. A stream is closed at once when its
   * session ends (logout, expiry, the per-device cap) or its device is revoked. The PC (loopback) has no session.
   */
  const clients = new Map<ServerResponse, { deviceId: string; sid: string | null }>();
  const closeStreams = (match: (c: { deviceId: string; sid: string | null }) => boolean) => {
    for (const [res, c] of [...clients]) {
      if (!match(c)) continue;
      clients.delete(res);
      res.end();
    }
  };
  auth?.onRevoke((deviceId) => closeStreams((c) => c.deviceId === deviceId));
  auth?.onSessionEnd((sid) => closeStreams((c) => c.sid === sid));
  const state = () => buildState({ lan: Boolean(auth), commands });
  /** The device-management flag depends on the caller: only this PC (loopback `pc`) may manage devices. */
  const withManage = (s: ReturnType<typeof state>, manage: boolean) => (manage ? { ...s, features: { ...s.features, manageDevices: true } } : s);

  async function serveStatic(res: ServerResponse, rel: string) {
    const file = normalize(join(publicDir, rel));
    if (!file.startsWith(publicDir.endsWith(sep) ? publicDir : publicDir + sep)) {
      res.writeHead(403, SECURITY_HEADERS).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', ...SECURITY_HEADERS });
      res.end(body);
    } catch {
      res.writeHead(404, SECURITY_HEADERS).end('Not found');
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const host = req.headers.host ?? '';
    const url = new URL(req.url ?? '/', `${proto}://localhost`);
    const method = req.method ?? 'GET';
    const ip = req.socket.remoteAddress ?? 'unknown';

    // DNS-rebinding guard: without a login, only answer requests addressed to loopback.
    if (!auth && !LOOPBACK_HOSTS.has(hostnameOf(host))) {
      send(res, 421, { error: 'misdirected request' });
      return;
    }

    // Cross-site requests never reach the API, not even GETs (some GETs spawn the CLI).
    if (url.pathname.startsWith('/api/') && req.headers['sec-fetch-site'] === 'cross-site') {
      send(res, 403, { error: 'cross-site request' });
      return;
    }

    // CSRF: every POST must come from this origin; API POSTs also need the custom header.
    if (method === 'POST') {
      const origin = req.headers.origin;
      if (origin !== `${proto}://${host}`) {
        send(res, 403, { error: 'bad origin' });
        return;
      }
      if (url.pathname.startsWith('/api/') && req.headers['x-dashboard'] !== '1') {
        send(res, 403, { error: 'missing X-Dashboard header' });
        return;
      }
    }

    if (auth && url.pathname === '/login') {
      if (method === 'POST') {
        const token = new URLSearchParams(await readBody(req)).get('token') ?? '';
        const r = auth.login(ip, token);
        if (r === 'rate-limited') {
          res.writeHead(303, { Location: '/login?e=rate', ...SECURITY_HEADERS }).end();
        } else if (r) {
          res.writeHead(303, { Location: '/', 'Set-Cookie': auth.cookie(r, Boolean(tls)), ...SECURITY_HEADERS }).end();
        } else {
          res.writeHead(303, { Location: '/login?e=1', ...SECURITY_HEADERS }).end();
        }
        return;
      }
      await serveStatic(res, '/login.html');
      return;
    }

    // QR pairing: GET only, no other side effect. A good code signs the browser in as its device; anything else is a
    // failed sign-in (rate limit + alert). The code is in the URL, so nothing is cached and it is spent on first use.
    if (auth && url.pathname === '/pair' && method === 'GET') {
      const r = auth.pair(ip, url.searchParams.get('c') ?? '');
      const base = { 'Cache-Control': 'no-store', ...SECURITY_HEADERS };
      if (r === 'rate-limited') res.writeHead(303, { Location: '/login?e=rate', ...base }).end();
      else if (r === null) res.writeHead(303, { Location: '/login?e=pair', ...base }).end();
      else res.writeHead(303, { Location: '/', 'Set-Cookie': auth.cookie(r, Boolean(tls)), ...base }).end();
      return;
    }

    // LAN mode: a device session, or this PC (loopback socket and loopback Host).
    const who = auth ? auth.identify(req) : null;
    if (auth && !PUBLIC_PATHS.has(url.pathname) && !who) {
      if (url.pathname.startsWith('/api/')) send(res, 401, { error: 'login required' });
      else res.writeHead(302, { Location: '/login', ...SECURITY_HEADERS }).end();
      return;
    }
    // Who is acting, for the audit log. Without a login (localhost mode) the caller is this PC.
    const actor = {
      deviceId: who?.deviceId ?? PC_DEVICE,
      device:
        !who || who.deviceId === PC_DEVICE ? 'This PC' : (auth?.devices.list().find((d) => d.id === who.deviceId)?.name ?? who.deviceId),
    };

    // Sliding session: the cookie is re-issued at most once a day.
    if (auth && who?.refreshSid) res.setHeader('Set-Cookie', auth.cookie(who.refreshSid, Boolean(tls)));

    if (auth && url.pathname === '/logout' && method === 'POST') {
      auth.logout(req);
      res.writeHead(303, { Location: '/login', 'Set-Cookie': auth.clearCookie(Boolean(tls)), ...SECURITY_HEADERS }).end();
      return;
    }

    if (url.pathname === '/api/state') {
      send(res, 200, withManage(state(), who?.deviceId === PC_DEVICE));
      return;
    }

    // The command log, newest first, allowlisted fields only. Any signed-in device (or this PC) may read it.
    if (url.pathname === '/api/audit' && method === 'GET') {
      const device = url.searchParams.get('device');
      if (device !== null && !/^[A-Za-z0-9_-]{1,64}$/.test(device)) throw new CommandError(400, 'invalid device filter');
      try {
        send(res, 200, { entries: await readAudit(device ?? undefined) });
      } catch {
        throw new CommandError(500, 'could not read the audit log');
      }
      return;
    }

    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', ...SECURITY_HEADERS });
      res.write(`data: ${JSON.stringify(withManage(state(), who?.deviceId === PC_DEVICE))}\n\n`);
      clients.set(res, { deviceId: who?.deviceId ?? '', sid: who?.sid ?? null });
      req.on('close', () => clients.delete(res));
      return;
    }

    // Subagent transcripts: the path comes from the scanner's index, never from the request.
    const sm = url.pathname.match(/^\/api\/subagents\/([A-Za-z0-9_-]{6,64})\/transcript$/);
    if (sm && method === 'GET') {
      scanTranscripts();
      const path = subagentPaths.get(sm[1]);
      if (!path) throw new CommandError(404, 'unknown subagent');
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 100));
      send(res, 200, await readTranscriptPage(path, limit, url.searchParams.get('before') ?? undefined, undefined, true));
      return;
    }

    const m = url.pathname.match(/^\/api\/sessions\/([^/]+)\/(transcript|summary|logs|message|stop)$/);
    if (m) {
      const [, id, action] = m;
      if (action === 'transcript' && method === 'GET') {
        if (!UUID_RE.test(id)) throw new CommandError(400, 'invalid session id');
        scanTranscripts();
        const t = transcriptIndex.get(id);
        if (!t) throw new CommandError(404, 'unknown session');
        const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 100));
        send(res, 200, await readTranscriptPage(t.path, limit, url.searchParams.get('before') ?? undefined));
        return;
      }
      if (action === 'summary' && method === 'GET') {
        if (!UUID_RE.test(id)) throw new CommandError(400, 'invalid session id');
        scanTranscripts();
        const t = transcriptIndex.get(id);
        if (!t) throw new CommandError(404, 'unknown session');
        const live = readSessions().find((s) => s.sessionId === id);
        send(res, 200, await summarize(t.path, 'recap', live && { status: live.status, startedAtMs: live.startedAtMs }));
        return;
      }
      if (!commands) throw new CommandError(404, 'commands are disabled');
      // stop/logs only address a background session by id; run them from the projects root.
      const cwd = projectsRoot;
      if (action === 'logs' && method === 'GET') {
        send(res, 200, await sessionLogs(id, cwd));
        return;
      }
      if (action === 'stop' && method === 'POST') {
        const r = await stopSession(id, cwd);
        audit({ ip, ...actor, action: 'stop', session: id, ok: r.ok });
        send(res, 200, r);
        return;
      }
      if (action === 'message' && method === 'POST') {
        const body = await readJson(req);
        const prompt = validatePrompt(body.prompt);
        const mode = validateMode(body.permissionMode);
        if (!UUID_RE.test(id)) throw new CommandError(400, 'invalid session id');
        scanTranscripts();
        const t = transcriptIndex.get(id);
        if (!t) throw new CommandError(404, 'unknown session');
        if (!insideProject(t.cwd, projectsRoot)) throw new CommandError(403, 'session folder is outside the projects folder');
        // One follow-up at a time per session: concurrent ones would each stop/resume it or start copies.
        if (continuing.has(id)) throw new CommandError(409, 'A message to this session is already being sent.');
        continuing.add(id);
        try {
          const isLive = () => readSessions().some((s) => s.sessionId === id);
          // `--bg --resume` on a running session starts a *copy* with a new id. To keep the same
          // session, an idle background session is stopped first (its conversation is kept).
          const live = readSessions().find((s) => s.sessionId === id);
          if (live) {
            if (live.kind !== 'bg') throw new CommandError(409, 'This session is open in a terminal or editor. Send the message there.');
            if (live.status !== 'idle') throw new CommandError(409, 'This session is busy or waiting. Wait until it is idle, then send the message.');
            const stopped = await stopSession(id, projectsRoot);
            audit({ ip, ...actor, action: 'stop', via: 'message', session: id, ok: stopped.ok });
            for (let i = 0; i < 25 && isLive(); i++) await new Promise((r) => setTimeout(r, 200));
            // Still running: resuming now would start a copy, so give up. (A failed stop of a session that exited on its own is fine.)
            if (isLive()) throw new CommandError(stopped.ok ? 504 : 502, 'The session did not stop. Try again.');
          }
          const r = await continueSession(id, t.cwd, prompt, mode);
          audit({ ip, ...actor, action: 'message', session: id, project: t.project, mode, prompt: prompt.slice(0, 200), ok: r.ok });
          send(res, 200, r);
        } finally {
          continuing.delete(id);
        }
        return;
      }
    }

    // Device management: only the loopback-exempt PC, never a signed-in LAN device (decision 0003).
    if (url.pathname === '/api/devices' || url.pathname === '/api/devices/revoke' || url.pathname === '/api/devices/pair') {
      if (!auth) throw new CommandError(404, 'devices are not available');
      if (who?.deviceId !== PC_DEVICE) throw new CommandError(403, 'only this PC can manage devices');
      if (url.pathname === '/api/devices' && method === 'GET') {
        send(res, 200, { devices: auth.devices.list() });
        return;
      }
      if (url.pathname === '/api/devices' && method === 'POST') {
        const body = await readJson(req);
        let created: { id: string; token: string };
        try {
          created = auth.devices.create(typeof body.name === 'string' ? body.name : '');
        } catch (e) {
          const msg = e instanceof Error ? e.message : '';
          audit({ ip, ...actor, action: 'device-create', ok: false });
          if (msg === 'invalid device name') throw new CommandError(400, 'invalid device name');
          if (msg === 'too many devices') throw new CommandError(409, `at most ${MAX_DEVICES} devices`);
          throw new CommandError(500, 'could not save the device');
        }
        audit({ ip, ...actor, action: 'device-create', id: created.id, name: auth.devices.list().find((d) => d.id === created.id)?.name, ok: true });
        send(res, 200, created);
        return;
      }
      if (url.pathname === '/api/devices/revoke' && method === 'POST') {
        const body = await readJson(req);
        const id = typeof body.id === 'string' ? body.id : '';
        const name = auth.devices.list().find((d) => d.id === id)?.name;
        const r = auth.revokeDevice(id);
        audit({ ip, ...actor, action: 'device-revoke', id: r.found ? id : undefined, name, found: r.found, persisted: r.persisted });
        if (!r.found) throw new CommandError(404, 'unknown device');
        // Sessions and streams are already ended; the file just could not be written, so it may come back after a restart.
        if (!r.persisted) throw new CommandError(500, 'device revoked, but the change could not be saved');
        send(res, 200, { ok: true });
        return;
      }
      if (url.pathname === '/api/devices/pair' && method === 'POST') {
        const body = await readJson(req);
        const id = typeof body.id === 'string' ? body.id : '';
        const pairing = auth.createPairing(id);
        audit({ ip, ...actor, action: 'device-pair', id: pairing ? id : undefined, ok: pairing !== null });
        if (!pairing) throw new CommandError(404, 'unknown device');
        // The phone needs this PC's LAN address, not the loopback Host the PC used. The code is the only secret in the link.
        const path = `/pair?c=${pairing.code}`;
        const port = req.socket.localPort;
        const urls = port ? lanAddresses().map((a) => `${proto}://${a}:${port}${path}`) : [];
        send(res, 200, { path, urls, expiresMs: pairing.expiresMs });
        return;
      }
      throw new CommandError(405, 'method not allowed');
    }

    if (url.pathname === '/api/alerts/dismiss' && method === 'POST') {
      const body = await readJson(req);
      if (typeof body.id !== 'string' || body.id.length === 0 || body.id.length > 200) throw new CommandError(400, 'invalid alert id');
      // Only an alert that is open right now can be dismissed, so the store can't be filled with arbitrary ids.
      if (!state().alerts.items.some((a) => a.id === body.id)) throw new CommandError(404, 'unknown alert');
      dismissAlert(body.id);
      send(res, 200, { ok: true });
      return;
    }

    if (url.pathname === '/api/settings/alerts' && method === 'POST') {
      const body = await readJson(req);
      if (typeof body.threshold !== 'number' || !setAlertThreshold(body.threshold)) throw new CommandError(400, 'threshold must be a whole number from 1 to 100');
      send(res, 200, { ok: true });
      return;
    }

    if (url.pathname === '/api/commands' && method === 'POST') {
      if (!commands) throw new CommandError(404, 'commands are disabled');
      const body = await readJson(req);
      const project = String(body.project ?? '');
      if (!projectNames(projectsRoot).includes(project)) throw new CommandError(400, 'unknown project');
      const prompt = validatePrompt(body.prompt);
      const mode = validateMode(body.permissionMode);
      const r = await startTask(join(projectsRoot, project), prompt, mode);
      audit({ ip, ...actor, action: 'start', project, mode, prompt: prompt.slice(0, 200), ok: r.ok, id: r.id });
      send(res, 200, r);
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      send(res, 404, { error: 'not found' });
      return;
    }
    if (method !== 'GET' && method !== 'HEAD') {
      send(res, 405, { error: 'method not allowed' });
      return;
    }
    let rel: string;
    try {
      rel = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400, SECURITY_HEADERS).end();
      return;
    }
    await serveStatic(res, rel);
  }

  const listener = (req: IncomingMessage, res: ServerResponse) => {
    handle(req, res).catch((e) => {
      if (res.headersSent) return res.end();
      if (e instanceof CommandError) send(res, e.status, { error: e.message });
      else send(res, 500, { error: 'internal error' });
    });
  };
  const server: Server = tls ? createHttpsServer({ key: tls.key, cert: tls.cert }, listener) : createHttpServer(listener);

  const timer = setInterval(() => {
    // An open stream makes no requests, so an expired session is noticed here.
    auth?.sweepExpired();
    if (!clients.size) return;
    const base = state();
    const plain = `data: ${JSON.stringify(base)}\n\n`;
    const pc = `data: ${JSON.stringify(withManage(base, true))}\n\n`;
    for (const [res, c] of clients) res.write(c.deviceId === PC_DEVICE ? pc : plain);
  }, 2000);
  server.on('close', () => {
    clearInterval(timer);
    for (const c of clients.keys()) c.end();
  });

  return server;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let opts: ServerOptions = {};
  // The old shared login token is no longer read; remove the leftover secret.
  rmSync(join(DATA_DIR, 'token'), { force: true });
  if (LAN_MODE) {
    // Failed sign-ins become one needs-attention alert per source address.
    opts = { auth: createAuth(createDeviceStore(DATA_DIR), { onFailedLogin: recordFailedSignin }), tls: ensureCert(DATA_DIR) };
    console.log('Sign-in uses per-device tokens; this PC (loopback address) needs none.');
  }
  createDashboardServer(opts).listen(PORT, HOST, () => {
    const proto = LAN_MODE ? 'https' : 'http';
    const hosts = LAN_MODE && (HOST === '0.0.0.0' || HOST === '::') ? lanAddresses() : [HOST];
    for (const h of hosts) console.log(`Claude dashboard on ${proto}://${h}:${PORT}`);
    console.log(`Commands ${COMMANDS_ENABLED ? 'enabled' : 'disabled'}${LAN_MODE ? ' · login required' : ''}`);
  });
}
