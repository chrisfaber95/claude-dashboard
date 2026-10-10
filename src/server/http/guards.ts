import type { IncomingMessage } from 'node:http';
import { join, normalize, sep } from 'node:path';

/** Reachable without a login session. */
export const PUBLIC_PATHS = new Set(['/login', '/login.js', '/pair.js', '/style.css', '/pair']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Headers on every response. */
export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  // same-origin (not no-referrer): no-referrer makes browsers send "Origin: null" on form POSTs.
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; form-action 'self'; base-uri 'none'",
};

/** A request a guard refuses: the status and the fixed error text to answer with. */
export interface GuardRejection {
  status: number;
  error: string;
}

/** What the guards need to know about one request. */
export interface GuardInput {
  req: IncomingMessage;
  pathname: string;
  method: string;
  /** `http` or `https`, the scheme this server answers on. */
  protocol: string;
  /** Login is required (LAN mode), so the loopback Host check does not apply. */
  isLoginRequired: boolean;
}

/** Hostname from the Host header itself (an absolute-form request target must not override it). */
function hostnameOf(host: string): string {
  if (host.startsWith('[')) return host.slice(0, host.indexOf(']') + 1);
  return host.split(':')[0].toLowerCase();
}

/** DNS-rebinding guard: without a login, only answer requests addressed to loopback. */
function checkHost(input: GuardInput): GuardRejection | null {
  const host = input.req.headers.host ?? '';
  if (!input.isLoginRequired && !LOOPBACK_HOSTS.has(hostnameOf(host))) return { status: 421, error: 'misdirected request' };
  return null;
}

/** Cross-site requests never reach the API, not even GETs (some GETs spawn the CLI). */
function checkFetchSite(input: GuardInput): GuardRejection | null {
  if (input.pathname.startsWith('/api/') && input.req.headers['sec-fetch-site'] === 'cross-site') {
    return { status: 403, error: 'cross-site request' };
  }
  return null;
}

/** CSRF: every POST must come from this origin; API POSTs also need the custom header. */
function checkPostOrigin(input: GuardInput): GuardRejection | null {
  if (input.method !== 'POST') return null;
  const host = input.req.headers.host ?? '';
  if (input.req.headers.origin !== `${input.protocol}://${host}`) return { status: 403, error: 'bad origin' };
  if (input.pathname.startsWith('/api/') && input.req.headers['x-dashboard'] !== '1') {
    return { status: 403, error: 'missing X-Dashboard header' };
  }
  return null;
}

/** Run the Host, cross-site and Origin/X-Dashboard checks in that order; the first refusal wins. */
export function findGuardRejection(input: GuardInput): GuardRejection | null {
  return checkHost(input) ?? checkFetchSite(input) ?? checkPostOrigin(input);
}

/** The absolute file for a static request, or null when it would leave the public folder. */
export function resolveStaticPath(publicDir: string, relativePath: string): string | null {
  const file = normalize(join(publicDir, relativePath));
  const prefix = publicDir.endsWith(sep) ? publicDir : publicDir + sep;
  return file.startsWith(prefix) ? file : null;
}
