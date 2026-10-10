import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_ROOT, DATA_DIR } from '../../config.ts';
import type { PermissionRequestInfo } from '../../../shared/types.ts';

/** The hook waits this long for an answer; Claude Code's own hook timeout (settings file) is a little longer. */
export const HOOK_WAIT_MS = 9 * 60_000;
const HOOK_TIMEOUT_S = 10 * 60;
/** Longest request text kept in state (it is pushed to every browser every 2 s). */
export const TEXT_MAX = 4000;
const EXPIRED_KEEP_MS = 10 * 60_000;
const EXPIRED_KEEP_MAX = 20;
const PENDING_MAX = 50;

export type Decision = 'allow' | 'deny' | 'expired';

interface Entry {
  info: PermissionRequestInfo;
  settle: (d: Decision) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** What the session wants to do, as text: the command for Bash, the pretty-printed input for anything else. */
export function requestText(tool: string, input: unknown): string {
  let text: string;
  if (tool === 'Bash' && input && typeof input === 'object' && typeof (input as { command?: unknown }).command === 'string') {
    text = (input as { command: string }).command;
  } else {
    try {
      text = JSON.stringify(input, null, 2) ?? '';
    } catch {
      text = '';
    }
  }
  // Control characters (terminal escapes in the answer helper) become spaces; newlines and tabs stay.
  text = text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ');
  return text.length > TEXT_MAX ?`${text.slice(0, TEXT_MAX)}…` : text;
}

export interface PermissionStore {
  /** True when `provided` is the hook secret (created on first use, kept in the data folder, never sent to a browser). */
  checkSecret(provided: unknown): boolean;
  /** Where the secret lives, for the hook script and the answer helper. */
  secretPath(): string;
  /** Holds a request until it is answered, expires or `abandon` is called. Resolves with the outcome. */
  request(sessionId: string, tool: string, text: string): { id: string; outcome: Promise<Decision> } | null;
  /** Answers a pending request; false when it is unknown or already settled. */
  answer(id: string, decision: 'allow' | 'deny'): boolean;
  /** The hook went away (killed, timed out) before an answer: the request shows as expired. */
  abandon(id: string): void;
  list(): PermissionRequestInfo[];
  /** Writes the `--settings` file for dashboard-started sessions and returns its path. */
  writeSettings(dashboardUrl: string): string;
}

export function createPermissionStore(opts: { dataDir?: string; waitMs?: number } = {}): PermissionStore {
  const dataDir = opts.dataDir ?? DATA_DIR;
  const waitMs = opts.waitMs ?? HOOK_WAIT_MS;
  const pending = new Map<string, Entry>();
  const expired: PermissionRequestInfo[] = [];
  let secretHash: Buffer | null = null;
  const secretPath = () => join(dataDir, 'hook-secret');

  function loadSecret(): Buffer {
    if (secretHash) return secretHash;
    mkdirSync(dataDir, { recursive: true });
    if (!existsSync(secretPath())) {
      const tmp = secretPath() + '.tmp';
      writeFileSync(tmp, randomBytes(32).toString('hex'), { mode: 0o600 });
      renameSync(tmp, secretPath());
      try {
        chmodSync(secretPath(), 0o600);
      } catch {
        // not supported on every file system
      }
    }
    secretHash = createHash('sha256').update(readFileSync(secretPath(), 'utf8').trim()).digest();
    return secretHash;
  }

  function finish(id: string, d: Decision) {
    const e = pending.get(id);
    if (!e) return false;
    pending.delete(id);
    clearTimeout(e.timer);
    if (d === 'expired') {
      expired.unshift({ ...e.info, status: 'expired' });
      expired.length = Math.min(expired.length, EXPIRED_KEEP_MAX);
    }
    e.settle(d);
    return true;
  }

  return {
    checkSecret(provided) {
      if (typeof provided !== 'string' || !provided) return false;
      try {
        return timingSafeEqual(createHash('sha256').update(provided).digest(), loadSecret());
      } catch {
        return false;
      }
    },
    secretPath,
    request(sessionId, tool, text) {
      if (pending.size >= PENDING_MAX) return null;
      const id = randomUUID();
      let settle: (d: Decision) => void = () => {};
      const outcome = new Promise<Decision>((r) => (settle = r));
      const timer = setTimeout(() => finish(id, 'expired'), waitMs);
      timer.unref();
      pending.set(id, { info: { id, sessionId, tool, text, createdMs: Date.now(), status: 'pending' }, settle, timer });
      return { id, outcome };
    },
    answer: (id, decision) => finish(id, decision),
    abandon: (id) => void finish(id, 'expired'),
    list() {
      const now = Date.now();
      const old = expired.filter((e) => now - e.createdMs < EXPIRED_KEEP_MS);
      return [...[...pending.values()].map((e) => e.info), ...old];
    },
    writeSettings(dashboardUrl) {
      loadSecret();
      const q = (p: string) => `"${p.replace(/\\/g, '/')}"`;
      const command = `${q(process.execPath)} ${q(join(APP_ROOT, 'scripts', 'permission-hook.mjs'))} --url ${q(dashboardUrl)} --secret-file ${q(secretPath())}`;
      const settings = { hooks: { PermissionRequest: [{ hooks: [{ type: 'command', command, timeout: HOOK_TIMEOUT_S }] }] } };
      const file = join(dataDir, 'permission-hook-settings.json');
      const tmp = file + '.tmp';
      writeFileSync(tmp, JSON.stringify(settings, null, 2));
      renameSync(tmp, file);
      return file;
    },
  };
}
