import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_ROOT, DATA_DIR } from '../../config.ts';
import type { PermissionRequestInfo } from '../../../shared/types/index.ts';

const MINUTE_MS = 60_000;
/** The hook waits this long for an answer; Claude Code's own hook timeout (settings file) is a little longer. */
export const HOOK_WAIT_MS = 9 * MINUTE_MS;
const HOOK_TIMEOUT_SECONDS = 10 * 60;
/** Longest request text kept in state (it is pushed to every browser every 2 s). */
export const TEXT_MAX = 4000;
const EXPIRED_KEEP_MS = 10 * MINUTE_MS;
const EXPIRED_KEEP_MAX = 20;
const PENDING_MAX = 50;
const SECRET_BYTES = 32;
const OWNER_ONLY_FILE_MODE = 0o600;
const JSON_INDENT = 2;

/** How a permission request ended. */
export type Decision = 'allow' | 'deny' | 'expired';

interface PendingEntry {
  info: PermissionRequestInfo;
  settle: (decision: Decision) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** What the session wants to do, as text: the command for Bash, the pretty-printed input for anything else. */
export function requestText(tool: string, input: unknown): string {
  let text: string;
  if (tool === 'Bash' && input && typeof input === 'object' && typeof (input as { command?: unknown }).command === 'string') {
    text = (input as { command: string }).command;
  } else {
    try {
      text = JSON.stringify(input, null, JSON_INDENT) ?? '';
    } catch {
      text = '';
    }
  }
  // Control characters (terminal escapes in the answer helper) become spaces; newlines and tabs stay.
  text = text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ');
  return text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX)}…` : text;
}

/** The operations the HTTP layer needs from the permission hook bridge. */
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
  /** Pending requests plus recently expired ones. */
  list(): PermissionRequestInfo[];
  /** Writes the `--settings` file for dashboard-started sessions and returns its path. */
  writeSettings(dashboardUrl: string): string;
}

/** Write a file by temp file + rename, so a reader never sees a half-written one. */
function writeFileAtomic(path: string, content: string, mode?: number): void {
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, content, mode === undefined ? undefined : { mode });
  renameSync(tempPath, path);
}

/** The hook secret: created on first use, only its hash is held in memory. */
function createSecretFile(dataDir: string) {
  const path = join(dataDir, 'hook-secret');
  let secretHash: Buffer | null = null;

  function load(): Buffer {
    if (secretHash) return secretHash;
    mkdirSync(dataDir, { recursive: true });
    if (!existsSync(path)) {
      writeFileAtomic(path, randomBytes(SECRET_BYTES).toString('hex'), OWNER_ONLY_FILE_MODE);
      try {
        chmodSync(path, OWNER_ONLY_FILE_MODE);
      } catch {
        // not supported on every file system
      }
    }
    secretHash = createHash('sha256').update(readFileSync(path, 'utf8').trim()).digest();
    return secretHash;
  }

  function check(provided: unknown): boolean {
    if (typeof provided !== 'string' || !provided) return false;
    try {
      return timingSafeEqual(createHash('sha256').update(provided).digest(), load());
    } catch {
      return false;
    }
  }

  return { path: () => path, load, check };
}

/** The open requests and the recently expired ones. */
function createRequestBook(waitMs: number) {
  const pending = new Map<string, PendingEntry>();
  const expired: PermissionRequestInfo[] = [];

  function finish(id: string, decision: Decision): boolean {
    const entry = pending.get(id);
    if (!entry) return false;
    pending.delete(id);
    clearTimeout(entry.timer);
    if (decision === 'expired') {
      expired.unshift({ ...entry.info, status: 'expired' });
      expired.length = Math.min(expired.length, EXPIRED_KEEP_MAX);
    }
    entry.settle(decision);
    return true;
  }

  return {
    request(sessionId: string, tool: string, text: string): { id: string; outcome: Promise<Decision> } | null {
      if (pending.size >= PENDING_MAX) return null;
      const id = randomUUID();
      let settle: (decision: Decision) => void = () => {};
      const outcome = new Promise<Decision>((resolve) => (settle = resolve));
      const timer = setTimeout(() => finish(id, 'expired'), waitMs);
      timer.unref();
      pending.set(id, { info: { id, sessionId, tool, text, createdMs: Date.now(), status: 'pending' }, settle, timer });
      return { id, outcome };
    },
    answer: (id: string, decision: 'allow' | 'deny') => finish(id, decision),
    abandon: (id: string) => void finish(id, 'expired'),
    list(): PermissionRequestInfo[] {
      const now = Date.now();
      const recentlyExpired = expired.filter((entry) => now - entry.createdMs < EXPIRED_KEEP_MS);
      return [...[...pending.values()].map((entry) => entry.info), ...recentlyExpired];
    },
  };
}

/** Quote a path or URL for the hook command line (forward slashes work for Node on Windows). */
function quoteArgument(value: string): string {
  return `"${value.replace(/\\/g, '/')}"`;
}

function writeHookSettings(dataDir: string, secretPath: string, dashboardUrl: string): string {
  const script = join(APP_ROOT, 'scripts', 'permission-hook.mjs');
  const command = `${quoteArgument(process.execPath)} ${quoteArgument(script)} --url ${quoteArgument(dashboardUrl)} --secret-file ${quoteArgument(secretPath)}`;
  const settings = { hooks: { PermissionRequest: [{ hooks: [{ type: 'command', command, timeout: HOOK_TIMEOUT_SECONDS }] }] } };
  const file = join(dataDir, 'permission-hook-settings.json');
  writeFileAtomic(file, JSON.stringify(settings, null, JSON_INDENT));
  return file;
}

/** Create the store that bridges permission-hook requests to the dashboard UI; `dataDir` and `waitMs` are test hooks. */
export function createPermissionStore(options: { dataDir?: string; waitMs?: number } = {}): PermissionStore {
  const dataDir = options.dataDir ?? DATA_DIR;
  const secret = createSecretFile(dataDir);
  const book = createRequestBook(options.waitMs ?? HOOK_WAIT_MS);
  return {
    checkSecret: secret.check,
    secretPath: secret.path,
    ...book,
    writeSettings(dashboardUrl) {
      secret.load();
      return writeHookSettings(dataDir, secret.path(), dashboardUrl);
    },
  };
}
