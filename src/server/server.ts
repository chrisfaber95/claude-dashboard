import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_ROOT, COMMANDS_ENABLED, DATA_DIR, HOST, LAN_MODE, PORT, PROJECTS_ROOT, UUID_RE, normPath } from './config.ts';
import { createAuth, loadOrCreateToken, type Auth } from './auth.ts';
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
import { buildState } from './state.ts';
import { ensureCert, lanAddresses } from './tls.ts';
import { readTranscriptPage } from './transcript-view.ts';
import { scanTranscripts, subagentPaths, transcriptIndex } from './transcripts.ts';

const PUBLIC_DIR = join(APP_ROOT, 'public');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
};
/** Reachable without a login session. */
const PUBLIC_PATHS = new Set(['/login', '/login.js', '/style.css']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const BODY_MAX = 64 * 1024;

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
  const clients = new Set<ServerResponse>();
  const state = () => buildState({ lan: Boolean(auth), commands });

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

    if (auth && !PUBLIC_PATHS.has(url.pathname) && !auth.isAuthed(req)) {
      if (url.pathname.startsWith('/api/')) send(res, 401, { error: 'login required' });
      else res.writeHead(302, { Location: '/login', ...SECURITY_HEADERS }).end();
      return;
    }

    if (auth && url.pathname === '/logout' && method === 'POST') {
      auth.logout(req);
      res.writeHead(303, { Location: '/login', 'Set-Cookie': auth.clearCookie(Boolean(tls)), ...SECURITY_HEADERS }).end();
      return;
    }

    if (url.pathname === '/api/state') {
      send(res, 200, state());
      return;
    }

    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', ...SECURITY_HEADERS });
      res.write(`data: ${JSON.stringify(state())}\n\n`);
      clients.add(res);
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

    const m = url.pathname.match(/^\/api\/sessions\/([^/]+)\/(transcript|logs|message|stop)$/);
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
      if (!commands) throw new CommandError(404, 'commands are disabled');
      // stop/logs only address a background session by id; run them from the projects root.
      const cwd = projectsRoot;
      if (action === 'logs' && method === 'GET') {
        send(res, 200, await sessionLogs(id, cwd));
        return;
      }
      if (action === 'stop' && method === 'POST') {
        const r = await stopSession(id, cwd);
        audit({ ip, action: 'stop', session: id, ok: r.ok });
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
        const r = await continueSession(id, t.cwd, prompt, mode);
        audit({ ip, action: 'message', session: id, project: t.project, mode, prompt: prompt.slice(0, 200), ok: r.ok });
        send(res, 200, r);
        return;
      }
    }

    if (url.pathname === '/api/commands' && method === 'POST') {
      if (!commands) throw new CommandError(404, 'commands are disabled');
      const body = await readJson(req);
      const project = String(body.project ?? '');
      if (!projectNames(projectsRoot).includes(project)) throw new CommandError(400, 'unknown project');
      const prompt = validatePrompt(body.prompt);
      const mode = validateMode(body.permissionMode);
      const r = await startTask(join(projectsRoot, project), prompt, mode);
      audit({ ip, action: 'start', project, mode, prompt: prompt.slice(0, 200), ok: r.ok, id: r.id });
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
    if (!clients.size) return;
    const payload = `data: ${JSON.stringify(state())}\n\n`;
    for (const c of clients) c.write(payload);
  }, 2000);
  server.on('close', () => {
    clearInterval(timer);
    for (const c of clients) c.end();
  });

  return server;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let opts: ServerOptions = {};
  if (LAN_MODE) {
    const { created } = loadOrCreateToken(DATA_DIR);
    opts = { auth: createAuth(loadOrCreateToken(DATA_DIR).token), tls: ensureCert(DATA_DIR) };
    console.log(created ? 'Created a new login token.' : 'Using the existing login token.');
    console.log(`Login token: ${join(DATA_DIR, 'token')}`);
  }
  createDashboardServer(opts).listen(PORT, HOST, () => {
    const proto = LAN_MODE ? 'https' : 'http';
    const hosts = LAN_MODE && (HOST === '0.0.0.0' || HOST === '::') ? lanAddresses() : [HOST];
    for (const h of hosts) console.log(`Claude dashboard on ${proto}://${h}:${PORT}`);
    console.log(`Commands ${COMMANDS_ENABLED ? 'enabled' : 'disabled'}${LAN_MODE ? ' · login required' : ''}`);
  });
}
