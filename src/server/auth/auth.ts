import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { DeviceStore } from './devices.ts';

const COOKIE = 'dash_sid';
const SESSION_MS = 7 * 86_400_000;
/** A session ends this long after sign-in even while in use (the 7-day slide never goes past it). */
export const SESSION_MAX_MS = 90 * 86_400_000;
/** At most this many live sessions per device; signing in again ends the oldest. */
export const MAX_SESSIONS_PER_DEVICE = 10;
const COOKIE_REISSUE_MS = 86_400_000;
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX = 5;
const PAIR_MS = 10 * 60_000;
const PAIR_MAX = 200;
const PAIR_CODE_MAX = 128;

/** The device id of a request from this PC (loopback socket and loopback Host). */
export const PC_DEVICE = 'pc';

const LOOPBACK_ADDRS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
/** Set by reverse proxies and tunnels. Never trusted; their presence only withdraws the loopback exemption. */
const PROXY_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'forwarded', 'via'];

/** Hostname from the Host header itself. */
function hostnameOf(host: string): string {
  if (host.startsWith('[')) return host.slice(0, host.indexOf(']') + 1);
  return host.split(':')[0].toLowerCase();
}

/**
 * Loopback exemption: the socket peer must be loopback AND the Host header a loopback host.
 * Forwarding headers (X-Forwarded-For and the like) are never trusted; if one is present the request is treated as
 * proxied and is not exempt, which also stops a same-PC proxy that adds them from opening the dashboard.
 */
export function isLoopbackRequest(req: IncomingMessage): boolean {
  if (PROXY_HEADERS.some((h) => req.headers[h] !== undefined)) return false;
  const addr = req.socket?.remoteAddress;
  return !!addr && LOOPBACK_ADDRS.has(addr) && LOOPBACK_HOSTS.has(hostnameOf(req.headers.host ?? ''));
}

export interface Identity {
  /** Device id, or `pc` for the loopback exemption. */
  deviceId: string;
  /** The session this request came in with; null for the loopback exemption (it has no session). */
  sid: string | null;
  /** Set when the session cookie should be re-issued with this session id (at most once a day). */
  refreshSid: string | null;
}

export interface AuthOptions {
  now?: () => number;
  /** Called for every failed or rate-limited sign-in. */
  onFailedLogin?: (ip: string, tMs: number) => void;
}

export interface Auth {
  readonly devices: DeviceStore;
  /** Returns a session id on success, 'rate-limited' when too many attempts, or null. */
  login(ip: string, provided: string): string | 'rate-limited' | null;
  /** Who is calling, or null. Slides the session to 7 days from now and records the device as seen. */
  identify(req: IncomingMessage): Identity | null;
  /**
   * A single-use pairing code for a device, valid 10 minutes, kept in memory only. Replaces the device's earlier unused
   * code. Null for an unknown device.
   */
  createPairing(deviceId: string): { code: string; expiresMs: number } | null;
  /**
   * Sign in with a pairing code: a session id, 'rate-limited', or null for an unknown, used or expired code. Shares the
   * login rate limit and reports failures like a bad token. The code is spent by the first try.
   */
  pair(ip: string, code: string): string | 'rate-limited' | null;
  /**
   * The name of the device a pairing code is for, or null for an unknown, used or expired code. Changes nothing: the
   * code is not spent and no attempt is counted (the confirm page for a scanned QR code uses it).
   */
  peekPairing(code: string): string | null;
  logout(req: IncomingMessage): void;
  /**
   * End the sessions that ran out (7 days unused, or 90 days since sign-in) and tell the listeners. Called on a timer by
   * the server, because an open event stream makes no requests that would notice the expiry.
   */
  sweepExpired(): void;
  /** Called with the session id whenever a session ends for any reason: logout, expiry, cap, revoke. */
  onSessionEnd(listener: (sid: string) => void): void;
  /** Delete the device, end its sessions and tell the listeners (open live-event streams). */
  revokeDevice(id: string): { found: boolean; persisted: boolean };
  onRevoke(listener: (deviceId: string) => void): void;
  cookie(sid: string, secure: boolean): string;
  clearCookie(secure: boolean): string;
}

export function readCookie(req: IncomingMessage, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

interface Session {
  deviceId: string;
  exp: number;
  cookieAt: number;
  /** When it was signed in: the 90-day limit counts from here. */
  startedAt: number;
}

export function createAuth(devices: DeviceStore, opts: AuthOptions = {}): Auth {
  const now = opts.now ?? Date.now;
  const sessions = new Map<string, Session>();
  const attempts = new Map<string, number[]>();
  const revokeListeners: Array<(deviceId: string) => void> = [];
  const endListeners: Array<(sid: string) => void> = [];
  const pairings = new Map<string, { deviceId: string; exp: number }>();

  /** End one session and tell the listeners (they close the event streams opened with it). */
  const endSession = (sid: string) => {
    if (!sessions.delete(sid)) return;
    for (const l of endListeners) {
      try {
        l(sid);
      } catch {
        // a broken listener must not stop the others
      }
    }
  };

  /** Drop expired sessions and stale attempt records so the maps can't grow without bound. */
  const sweep = (t: number) => {
    for (const [sid, s] of [...sessions]) if (s.exp < t || !devices.has(s.deviceId)) endSession(sid);
    for (const [code, p] of pairings) if (p.exp < t) pairings.delete(code);
    for (const [ip, list] of attempts) if (!list.some((x) => t - x < LOGIN_WINDOW_MS)) attempts.delete(ip);
  };

  const failed = (ip: string, t: number) => {
    try {
      opts.onFailedLogin?.(ip, t);
    } catch {
      // a broken hook must not break sign-in
    }
  };

  /** The shared per-IP sign-in limit (tokens and pairing codes count together). Returns the time, or null when limited. */
  const attempt = (ip: string): number | null => {
    const t = now();
    sweep(t);
    const recent = (attempts.get(ip) ?? []).filter((x) => t - x < LOGIN_WINDOW_MS);
    if (recent.length >= LOGIN_MAX) {
      attempts.set(ip, recent);
      failed(ip, t);
      return null;
    }
    recent.push(t);
    attempts.set(ip, recent);
    return t;
  };

  const startSession = (ip: string, deviceId: string, t: number): string => {
    attempts.delete(ip);
    const sid = randomBytes(32).toString('base64url');
    // A device keeps at most MAX_SESSIONS_PER_DEVICE sessions: the oldest (first inserted) ends to make room.
    const mine = [...sessions].filter(([, s]) => s.deviceId === deviceId).map(([id]) => id);
    for (const old of mine.slice(0, Math.max(0, mine.length - MAX_SESSIONS_PER_DEVICE + 1))) endSession(old);
    sessions.set(sid, { deviceId, exp: t + SESSION_MS, cookieAt: t, startedAt: t });
    devices.touch(deviceId);
    return sid;
  };

  const dropPairings = (deviceId: string) => {
    for (const [code, p] of pairings) if (p.deviceId === deviceId) pairings.delete(code);
  };

  return {
    devices,
    login(ip, provided) {
      const t = attempt(ip);
      if (t === null) return 'rate-limited';
      const device = devices.verify(provided.trim());
      if (!device) {
        failed(ip, t);
        return null;
      }
      return startSession(ip, device.id, t);
    },
    createPairing(deviceId) {
      if (!devices.has(deviceId)) return null;
      const t = now();
      sweep(t);
      dropPairings(deviceId); // only the newest code of a device works
      if (pairings.size >= PAIR_MAX) {
        const oldest = pairings.keys().next().value;
        if (oldest !== undefined) pairings.delete(oldest);
      }
      const code = randomBytes(32).toString('base64url');
      const expiresMs = t + PAIR_MS;
      pairings.set(code, { deviceId, exp: expiresMs });
      return { code, expiresMs };
    },
    pair(ip, code) {
      const t = attempt(ip);
      if (t === null) return 'rate-limited';
      const p = typeof code === 'string' && code.length <= PAIR_CODE_MAX ? pairings.get(code) : undefined;
      if (p) pairings.delete(code); // single use: spent even when it turns out to be expired
      if (!p || p.exp < t || !devices.has(p.deviceId)) {
        failed(ip, t);
        return null;
      }
      return startSession(ip, p.deviceId, t);
    },
    peekPairing(code) {
      const p = typeof code === 'string' && code.length <= PAIR_CODE_MAX ? pairings.get(code) : undefined;
      if (!p || p.exp < now()) return null;
      return devices.list().find((d) => d.id === p.deviceId)?.name ?? null;
    },
    identify(req) {
      if (isLoopbackRequest(req)) return { deviceId: PC_DEVICE, sid: null, refreshSid: null };
      const sid = readCookie(req, COOKIE);
      if (!sid) return null;
      const s = sessions.get(sid);
      if (!s) return null;
      const t = now();
      if (s.exp < t || !devices.has(s.deviceId)) {
        endSession(sid);
        return null;
      }
      s.exp = Math.min(t + SESSION_MS, s.startedAt + SESSION_MAX_MS);
      devices.touch(s.deviceId);
      let refreshSid: string | null = null;
      if (t - s.cookieAt >= COOKIE_REISSUE_MS) {
        s.cookieAt = t;
        refreshSid = sid;
      }
      return { deviceId: s.deviceId, sid, refreshSid };
    },
    logout(req) {
      const sid = readCookie(req, COOKIE);
      if (sid) endSession(sid);
    },
    sweepExpired() {
      sweep(now());
    },
    onSessionEnd(listener) {
      endListeners.push(listener);
    },
    revokeDevice(id) {
      const r = devices.revoke(id);
      // Sessions end and streams close even when the file could not be written; the caller reports `persisted`.
      for (const [sid, s] of [...sessions]) if (s.deviceId === id) endSession(sid);
      dropPairings(id);
      if (r.found) {
        for (const l of revokeListeners) {
          try {
            l(id);
          } catch {
            // the device is already gone; one broken listener must not hide that or stop the others
          }
        }
      }
      return r;
    },
    onRevoke(listener) {
      revokeListeners.push(listener);
    },
    cookie(sid, secure) {
      return `${COOKIE}=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure ? '; Secure' : ''}`;
    },
    clearCookie(secure) {
      return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
    },
  };
}
