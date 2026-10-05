import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';

const COOKIE = 'dash_sid';
const SESSION_MS = 7 * 86_400_000;
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX = 5;

export interface Auth {
  /** Returns a session id on success, 'rate-limited' when too many attempts, or null. */
  login(ip: string, provided: string): string | 'rate-limited' | null;
  isAuthed(req: IncomingMessage): boolean;
  logout(req: IncomingMessage): void;
  cookie(sid: string, secure: boolean): string;
  clearCookie(secure: boolean): string;
}

/** Load the login token from `<dataDir>/token`, creating it on first run. */
export function loadOrCreateToken(dataDir: string): { token: string; created: boolean } {
  const file = join(dataDir, 'token');
  if (existsSync(file)) {
    const token = readFileSync(file, 'utf8').trim();
    if (token.length >= 32) return { token, created: false };
  }
  mkdirSync(dataDir, { recursive: true });
  const token = randomBytes(32).toString('base64url');
  writeFileSync(file, token + '\n', { mode: 0o600 });
  return { token, created: true };
}

export function readCookie(req: IncomingMessage, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function createAuth(token: string, now: () => number = Date.now): Auth {
  const expected = Buffer.from(token);
  const sessions = new Map<string, number>();
  const attempts = new Map<string, number[]>();

  /** Drop expired sessions and stale attempt records so the maps can't grow without bound. */
  const sweep = (t: number) => {
    for (const [sid, exp] of sessions) if (exp < t) sessions.delete(sid);
    for (const [ip, list] of attempts) if (!list.some((x) => t - x < LOGIN_WINDOW_MS)) attempts.delete(ip);
  };

  const valid = (provided: string) => {
    const got = Buffer.from(provided);
    return got.length === expected.length && timingSafeEqual(got, expected);
  };

  return {
    login(ip, provided) {
      const t = now();
      sweep(t);
      const recent = (attempts.get(ip) ?? []).filter((x) => t - x < LOGIN_WINDOW_MS);
      if (recent.length >= LOGIN_MAX) {
        attempts.set(ip, recent);
        return 'rate-limited';
      }
      recent.push(t);
      attempts.set(ip, recent);
      if (!valid(provided.trim())) return null;
      attempts.delete(ip);
      const sid = randomBytes(32).toString('base64url');
      sessions.set(sid, t + SESSION_MS);
      return sid;
    },
    isAuthed(req) {
      const sid = readCookie(req, COOKIE);
      if (!sid) return false;
      const exp = sessions.get(sid);
      if (!exp) return false;
      if (exp < now()) {
        sessions.delete(sid);
        return false;
      }
      return true;
    },
    logout(req) {
      const sid = readCookie(req, COOKIE);
      if (sid) sessions.delete(sid);
    },
    cookie(sid, secure) {
      return `${COOKIE}=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure ? '; Secure' : ''}`;
    },
    clearCookie(secure) {
      return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
    },
  };
}
