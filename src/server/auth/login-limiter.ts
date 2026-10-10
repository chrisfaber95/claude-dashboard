const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX = 5;

/** Per-IP sign-in attempt counter, kept in memory. */
export interface LoginLimiter {
  /** Counts an attempt for the IP; false (and nothing counted) when it already used its quota in the window. */
  tryAttempt(ip: string, timeMs: number): boolean;
  /** Forget the IP's attempts (after a successful sign-in). */
  clear(ip: string): void;
  /** Drop IPs whose attempts all fell out of the window so the map can't grow without bound. */
  sweep(timeMs: number): void;
}

/** Creates a limiter allowing 5 attempts per IP per minute. */
export function createLoginLimiter(): LoginLimiter {
  const attempts = new Map<string, number[]>();
  const recentOf = (ip: string, timeMs: number) => (attempts.get(ip) ?? []).filter((at) => timeMs - at < LOGIN_WINDOW_MS);
  return {
    tryAttempt(ip, timeMs) {
      const recent = recentOf(ip, timeMs);
      const isAllowed = recent.length < LOGIN_MAX;
      if (isAllowed) recent.push(timeMs);
      attempts.set(ip, recent);
      return isAllowed;
    },
    clear(ip) {
      attempts.delete(ip);
    },
    sweep(timeMs) {
      for (const [ip, list] of attempts) if (!list.some((at) => timeMs - at < LOGIN_WINDOW_MS)) attempts.delete(ip);
    },
  };
}
