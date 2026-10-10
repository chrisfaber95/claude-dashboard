import type { IncomingMessage } from 'node:http';
import type { DeviceStore } from './devices.ts';
import { createLoginLimiter, type LoginLimiter } from './login-limiter.ts';
import { isLoopbackRequest } from './loopback.ts';
import { createPairingStore, type PairingStore } from './pairings.ts';
import { createSessionStore, SESSION_MS, type SessionStore } from './sessions.ts';

export { isLoopbackRequest } from './loopback.ts';
export { MAX_SESSIONS_PER_DEVICE, SESSION_MAX_MS } from './sessions.ts';

const COOKIE = 'dash_sid';

/** The device id of a request from this PC (loopback socket and loopback Host). */
export const PC_DEVICE = 'pc';

/** Who a request belongs to. */
export interface Identity {
  /** Device id, or `pc` for the loopback exemption. */
  deviceId: string;
  /** The session this request came in with; null for the loopback exemption (it has no session). */
  // eslint-disable-next-line id-denylist -- part of the Identity shape that server.ts and the tests read
  sid: string | null;
  /** Set when the session cookie should be re-issued with this session id (at most once a day). */
  refreshSid: string | null;
}

/** Options of createAuth. */
export interface AuthOptions {
  now?: () => number;
  /** Called for every failed or rate-limited sign-in. */
  onFailedLogin?: (ip: string, tMs: number) => void;
}

/** Sign-in, sessions, pairing codes and device revocation of the LAN login. */
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
  onSessionEnd(listener: (sessionId: string) => void): void;
  /** Delete the device, end its sessions and tell the listeners (open live-event streams). */
  revokeDevice(id: string): { found: boolean; persisted: boolean };
  onRevoke(listener: (deviceId: string) => void): void;
  cookie(sessionId: string, isSecure: boolean): string;
  clearCookie(isSecure: boolean): string;
}

/** The value of one cookie of a request, or null. */
export function readCookie(req: IncomingMessage, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex > 0 && part.slice(0, separatorIndex).trim() === name) {
      try {
        return decodeURIComponent(part.slice(separatorIndex + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** The stores and clock the auth methods share. */
interface AuthParts {
  devices: DeviceStore;
  now: () => number;
  sessions: SessionStore;
  pairings: PairingStore;
  limiter: LoginLimiter;
  reportFailure: (ip: string, timeMs: number) => void;
}

/** Drop expired sessions, pairing codes and stale attempt records so the maps can't grow without bound. */
function sweepAll(parts: AuthParts, timeMs: number): void {
  parts.sessions.sweep(timeMs);
  parts.pairings.sweep(timeMs);
  parts.limiter.sweep(timeMs);
}

/** The shared per-IP sign-in limit (tokens and pairing codes count together). Returns the time, or null when limited. */
function tryAttempt(parts: AuthParts, ip: string): number | null {
  const timeMs = parts.now();
  sweepAll(parts, timeMs);
  if (parts.limiter.tryAttempt(ip, timeMs)) return timeMs;
  parts.reportFailure(ip, timeMs);
  return null;
}

/** Open a session for a device that just proved itself; the IP's failed attempts are forgotten. */
function startSession(parts: AuthParts, ip: string, deviceId: string, timeMs: number): string {
  parts.limiter.clear(ip);
  return parts.sessions.start(deviceId, timeMs);
}

type SignInMethods = Pick<Auth, 'login' | 'pair' | 'createPairing' | 'peekPairing'>;

/** Sign-in with a device token or a pairing code, and the creation of pairing codes. */
function createSignIn(parts: AuthParts): SignInMethods {
  const { devices, pairings } = parts;
  return {
    login(ip, provided) {
      const timeMs = tryAttempt(parts, ip);
      if (timeMs === null) return 'rate-limited';
      const device = devices.verify(provided.trim());
      if (!device) {
        parts.reportFailure(ip, timeMs);
        return null;
      }
      return startSession(parts, ip, device.id, timeMs);
    },
    createPairing(deviceId) {
      if (!devices.has(deviceId)) return null;
      const timeMs = parts.now();
      sweepAll(parts, timeMs);
      return pairings.create(deviceId, timeMs);
    },
    pair(ip, code) {
      const timeMs = tryAttempt(parts, ip);
      if (timeMs === null) return 'rate-limited';
      const pairing = pairings.take(code); // single use: spent even when it turns out to be expired
      if (!pairing || pairing.expiresMs < timeMs || !devices.has(pairing.deviceId)) {
        parts.reportFailure(ip, timeMs);
        return null;
      }
      return startSession(parts, ip, pairing.deviceId, timeMs);
    },
    peekPairing(code) {
      const pairing = pairings.peek(code);
      if (!pairing || pairing.expiresMs < parts.now()) return null;
      return devices.list().find((device) => device.id === pairing.deviceId)?.name ?? null;
    },
  };
}

type SessionMethods = Pick<Auth, 'identify' | 'logout' | 'sweepExpired' | 'onSessionEnd'>;

/** Who a request is, ending sessions, and the periodic expiry sweep. */
function createSessionMethods(parts: AuthParts): SessionMethods {
  return {
    identify(req) {
      // eslint-disable-next-line id-denylist -- the Identity shape keeps its `sid` field
      if (isLoopbackRequest(req)) return { deviceId: PC_DEVICE, sid: null, refreshSid: null };
      const sessionId = readCookie(req, COOKIE);
      if (!sessionId) return null;
      const renewed = parts.sessions.renew(sessionId);
      if (!renewed) return null;
      const refreshSid = renewed.shouldReissueCookie ? sessionId : null;
      // eslint-disable-next-line id-denylist -- the Identity shape keeps its `sid` field
      return { deviceId: renewed.deviceId, sid: sessionId, refreshSid };
    },
    logout(req) {
      const sessionId = readCookie(req, COOKIE);
      if (sessionId) parts.sessions.end(sessionId);
    },
    sweepExpired() {
      sweepAll(parts, parts.now());
    },
    onSessionEnd(listener) {
      parts.sessions.onEnd(listener);
    },
  };
}

type RevokeMethods = Pick<Auth, 'revokeDevice' | 'onRevoke'>;

/** Device revocation and its listeners. */
function createRevocation(parts: AuthParts): RevokeMethods {
  const revokeListeners: Array<(deviceId: string) => void> = [];
  return {
    revokeDevice(id) {
      const result = parts.devices.revoke(id);
      // Sessions end and streams close even when the file could not be written; the caller reports `persisted`.
      parts.sessions.endAllOf(id);
      parts.pairings.dropAllOf(id);
      if (!result.found) return result;
      for (const listener of revokeListeners) {
        try {
          listener(id);
        } catch {
          // the device is already gone; one broken listener must not hide that or stop the others
        }
      }
      return result;
    },
    onRevoke(listener) {
      revokeListeners.push(listener);
    },
  };
}

/** The Set-Cookie value for the session cookie, or one that clears it when the session id is empty. */
function sessionCookie(sessionId: string, maxAgeSeconds: number, isSecure: boolean): string {
  return `${COOKIE}=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}${isSecure ? '; Secure' : ''}`;
}

/** Creates the auth service over a device store; sessions and pairing codes live in memory only. */
export function createAuth(devices: DeviceStore, options: AuthOptions = {}): Auth {
  const now = options.now ?? Date.now;
  const parts: AuthParts = {
    devices,
    now,
    sessions: createSessionStore(devices, now),
    pairings: createPairingStore(),
    limiter: createLoginLimiter(),
    reportFailure(ip, timeMs) {
      try {
        options.onFailedLogin?.(ip, timeMs);
      } catch {
        // a broken hook must not break sign-in
      }
    },
  };
  return {
    devices,
    ...createSignIn(parts),
    ...createSessionMethods(parts),
    ...createRevocation(parts),
    cookie: (sessionId, isSecure) => sessionCookie(sessionId, SESSION_MS / 1000, isSecure),
    clearCookie: (isSecure) => sessionCookie('', 0, isSecure),
  };
}
