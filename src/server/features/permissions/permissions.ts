import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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
/** Answered or expired ids remembered so a late second answer is "already answered" (409), not "unknown" (404). */
const SETTLED_IDS_KEEP_MAX = 500;
/** Longest request text written to the audit log. */
export const APPROVAL_TEXT_AUDIT_MAX = 500;
const HOOK_SCRIPT_NAME = 'permission-hook.mjs';
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

/** What `PermissionStore.answer` did with one answer. */
export type AnswerResult =
  | { outcome: 'answered'; request: PermissionRequestInfo }
  | { outcome: 'settled' }
  | { outcome: 'unknown' };

/** The operations the HTTP layer needs from the permission hook bridge. */
export interface PermissionStore {
  /** True when `provided` is the hook secret (created on first use, kept in the data folder, never sent to a browser). */
  checkSecret(provided: unknown): boolean;
  /** Where the secret lives, for the hook script and the answer helper. */
  secretPath(): string;
  /** Holds a request until it is answered, expires or `abandon` is called. Resolves with the outcome. */
  request(sessionId: string, tool: string, text: string): { id: string; outcome: Promise<Decision> } | null;
  /** Answers a pending request once; an id that was already answered or expired is told apart from an unknown one. */
  answer(id: string, decision: 'allow' | 'deny'): AnswerResult;
  /** Calls `listener` for every request that expired (no answer in time, or the hook went away). */
  onExpired(listener: (request: PermissionRequestInfo) => void): void;
  /** The hook went away (killed, timed out) before an answer: the request shows as expired. */
  abandon(id: string): void;
  /** Pending requests plus recently expired ones. */
  list(): PermissionRequestInfo[];
  /** Copies the hook script and writes the `--settings` file into the data folder; returns the settings path. */
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
  const settledIds = new Set<string>();
  const expiredListeners: ((request: PermissionRequestInfo) => void)[] = [];

  function rememberSettled(id: string): void {
    settledIds.add(id);
    // A Set iterates in insertion order, so the first value is the oldest.
    if (settledIds.size > SETTLED_IDS_KEEP_MAX) settledIds.delete(settledIds.values().next().value as string);
  }

  function finish(id: string, decision: Decision): PermissionRequestInfo | null {
    const entry = pending.get(id);
    if (!entry) return null;
    pending.delete(id);
    clearTimeout(entry.timer);
    rememberSettled(id);
    if (decision === 'expired') {
      const expiredInfo: PermissionRequestInfo = { ...entry.info, status: 'expired' };
      expired.unshift(expiredInfo);
      expired.length = Math.min(expired.length, EXPIRED_KEEP_MAX);
      for (const listener of expiredListeners) listener(expiredInfo);
    }
    entry.settle(decision);
    return entry.info;
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
    answer(id: string, decision: 'allow' | 'deny'): AnswerResult {
      const request = finish(id, decision);
      if (request) return { outcome: 'answered', request };
      return { outcome: settledIds.has(id) ? 'settled' : 'unknown' };
    },
    onExpired: (listener: (request: PermissionRequestInfo) => void) => void expiredListeners.push(listener),
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

/**
 * The hook runs from a copy in the data folder, rewritten at every server start, so a session that edits the repo's
 * `scripts/` cannot change the hook that guards it.
 */
function copyHookScript(dataDir: string): string {
  const copyPath = join(dataDir, HOOK_SCRIPT_NAME);
  const tempPath = `${copyPath}.tmp`;
  copyFileSync(join(APP_ROOT, 'scripts', HOOK_SCRIPT_NAME), tempPath);
  renameSync(tempPath, copyPath);
  return copyPath;
}

function writeHookSettings(dataDir: string, secretPath: string, dashboardUrl: string): string {
  const script = copyHookScript(dataDir);
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
