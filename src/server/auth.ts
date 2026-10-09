import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { DeviceStore } from './devices.ts';

const COOKIE = 'dash_sid';
const SESSION_MS = 7 * 86_400_000;
const COOKIE_REISSUE_MS = 86_400_000;
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX = 5;

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
  logout(req: IncomingMessage): void;
  /** Delete the device, end its sessions and tell the listeners (open live-event streams). */
  revokeDevice(id: string): boolean;
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
}

export function createAuth(devices: DeviceStore, opts: AuthOptions = {}): Auth {
  const now = opts.now ?? Date.now;
  const sessions = new Map<string, Session>();
  const attempts = new Map<string, number[]>();
  const revokeListeners: Array<(deviceId: string) => void> = [];

  /** Drop expired sessions and stale attempt records so the maps can't grow without bound. */
  const sweep = (t: number) => {
    for (const [sid, s] of sessions) if (s.exp < t) sessions.delete(sid);
    for (const [ip, list] of attempts) if (!list.some((x) => t - x < LOGIN_WINDOW_MS)) attempts.delete(ip);
  };

  const failed = (ip: string, t: number) => {
    try {
      opts.onFailedLogin?.(ip, t);
    } catch {
      // a broken hook must not break sign-in
    }
  };

  return {
    devices,
    login(ip, provided) {
      const t = now();
      sweep(t);
      const recent = (attempts.get(ip) ?? []).filter((x) => t - x < LOGIN_WINDOW_MS);
      if (recent.length >= LOGIN_MAX) {
        attempts.set(ip, recent);
        failed(ip, t);
        return 'rate-limited';
      }
      recent.push(t);
      attempts.set(ip, recent);
      const device = devices.verify(provided.trim());
      if (!device) {
        failed(ip, t);
        return null;
      }
      attempts.delete(ip);
      const sid = randomBytes(32).toString('base64url');
      sessions.set(sid, { deviceId: device.id, exp: t + SESSION_MS, cookieAt: t });
      devices.touch(device.id);
      return sid;
    },
    identify(req) {
      if (isLoopbackRequest(req)) return { deviceId: PC_DEVICE, refreshSid: null };
      const sid = readCookie(req, COOKIE);
      if (!sid) return null;
      const s = sessions.get(sid);
      if (!s) return null;
      const t = now();
      if (s.exp < t || !devices.has(s.deviceId)) {
        sessions.delete(sid);
        return null;
      }
      s.exp = t + SESSION_MS;
      devices.touch(s.deviceId);
      let refreshSid: string | null = null;
      if (t - s.cookieAt >= COOKIE_REISSUE_MS) {
        s.cookieAt = t;
        refreshSid = sid;
      }
      return { deviceId: s.deviceId, refreshSid };
    },
    logout(req) {
      const sid = readCookie(req, COOKIE);
      if (sid) sessions.delete(sid);
    },
    revokeDevice(id) {
      const existed = devices.revoke(id);
      for (const [sid, s] of sessions) if (s.deviceId === id) sessions.delete(sid);
      if (existed) for (const l of revokeListeners) l(id);
      return existed;
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
