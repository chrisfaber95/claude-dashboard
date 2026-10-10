import { randomBytes } from 'node:crypto';
import type { DeviceStore } from './devices.ts';

/** How long a session lasts without use; each request slides it forward. */
export const SESSION_MS = 7 * 86_400_000;
/** A session ends this long after sign-in even while in use (the 7-day slide never goes past it). */
export const SESSION_MAX_MS = 90 * 86_400_000;
/** At most this many live sessions per device; signing in again ends the oldest. */
export const MAX_SESSIONS_PER_DEVICE = 10;
const COOKIE_REISSUE_MS = 86_400_000;
const SESSION_ID_BYTES = 32;

interface Session {
  deviceId: string;
  expiresMs: number;
  cookieIssuedMs: number;
  /** When it was signed in: the 90-day limit counts from here. */
  startedMs: number;
}

/** What a live session tells the caller: its device and whether the cookie is due for re-issue. */
export interface RenewedSession {
  deviceId: string;
  shouldReissueCookie: boolean;
}

/** The in-memory sessions of signed-in devices. */
export interface SessionStore {
  /** Open a session for the device and return its id; the device's oldest session goes when it is at the cap. */
  start(deviceId: string, timeMs: number): string;
  /** End one session and tell the listeners (they close the event streams opened with it). */
  end(sessionId: string): void;
  /** End every session of a device. */
  endAllOf(deviceId: string): void;
  /** Slide a live session and record the device as seen; null (and the session ends) when it is unknown or expired. */
  renew(sessionId: string): RenewedSession | null;
  /** End sessions that ran out or whose device is gone. */
  sweep(timeMs: number): void;
  /** Called with the session id whenever a session ends for any reason. */
  onEnd(listener: (sessionId: string) => void): void;
}

/** Creates the session store; `now` is the clock used when a session is renewed. */
export function createSessionStore(devices: DeviceStore, now: () => number): SessionStore {
  const sessions = new Map<string, Session>();
  const endListeners: Array<(sessionId: string) => void> = [];

  function end(sessionId: string): void {
    if (!sessions.delete(sessionId)) return;
    for (const listener of endListeners) {
      try {
        listener(sessionId);
      } catch {
        // a broken listener must not stop the others
      }
    }
  }

  return {
    start(deviceId, timeMs) {
      const sessionId = randomBytes(SESSION_ID_BYTES).toString('base64url');
      // A device keeps at most MAX_SESSIONS_PER_DEVICE sessions: the oldest (first inserted) ends to make room.
      const ownIds = [...sessions].filter(([, session]) => session.deviceId === deviceId).map(([id]) => id);
      for (const oldId of ownIds.slice(0, Math.max(0, ownIds.length - MAX_SESSIONS_PER_DEVICE + 1))) end(oldId);
      sessions.set(sessionId, { deviceId, expiresMs: timeMs + SESSION_MS, cookieIssuedMs: timeMs, startedMs: timeMs });
      devices.touch(deviceId);
      return sessionId;
    },
    end,
    endAllOf(deviceId) {
      for (const [sessionId, session] of [...sessions]) if (session.deviceId === deviceId) end(sessionId);
    },
    renew(sessionId) {
      const session = sessions.get(sessionId);
      if (!session) return null;
      const timeMs = now();
      if (session.expiresMs < timeMs || !devices.has(session.deviceId)) {
        end(sessionId);
        return null;
      }
      session.expiresMs = Math.min(timeMs + SESSION_MS, session.startedMs + SESSION_MAX_MS);
      devices.touch(session.deviceId);
      const shouldReissueCookie = timeMs - session.cookieIssuedMs >= COOKIE_REISSUE_MS;
      if (shouldReissueCookie) session.cookieIssuedMs = timeMs;
      return { deviceId: session.deviceId, shouldReissueCookie };
    },
    sweep(timeMs) {
      for (const [sessionId, session] of [...sessions]) {
        if (session.expiresMs < timeMs || !devices.has(session.deviceId)) end(sessionId);
      }
    },
    onEnd(listener) {
      endListeners.push(listener);
    },
  };
}
