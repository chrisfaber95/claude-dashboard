import { execFile } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DATA_DIR, UUID_RE } from './config.ts';
import { PERMISSION_MODES, type CommandResult, type PermissionMode } from '../shared/types.ts';

export const PROMPT_MAX = 20_000;
const TIMEOUT_MS = 60_000;
/** Upper bound on simultaneous CLI processes, so a flood of requests can't exhaust the machine. */
const MAX_CONCURRENT = 4;
let running = 0;
/** Ids that `claude stop/logs` accept: session UUIDs or the short background ids. Never starts with '-'. */
const BG_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{3,63}$/;

export class CommandError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** `CLAUDE_BIN` (+ optional JSON `CLAUDE_BIN_ARGS` prefix, used by tests), else the newest VS Code extension binary. */
export function resolveClaudeBin(): { bin: string; prefix: string[] } | null {
  if (process.env.CLAUDE_BIN) {
    const prefix = process.env.CLAUDE_BIN_ARGS ? (JSON.parse(process.env.CLAUDE_BIN_ARGS) as string[]) : [];
    return { bin: process.env.CLAUDE_BIN, prefix };
  }
  const extDir = join(homedir(), '.vscode', 'extensions');
  let dirs: string[] = [];
  try {
    dirs = readdirSync(extDir).filter((d) => d.startsWith('anthropic.claude-code-'));
  } catch {
    return null;
  }
  const version = (d: string) => (d.match(/(\d+)\.(\d+)\.(\d+)/) ?? []).slice(1).map(Number);
  dirs.sort((a, b) => {
    const [x, y] = [version(a), version(b)];
    for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
    return 0;
  });
  for (const d of dirs.reverse()) {
    const bin = join(extDir, d, 'resources', 'native-binary', process.platform === 'win32' ? 'claude.exe' : 'claude');
    if (existsSync(bin)) return { bin, prefix: [] };
  }
  return null;
}

export function validateMode(mode: unknown): PermissionMode {
  const m = mode ?? 'auto';
  if (!PERMISSION_MODES.includes(m as PermissionMode)) throw new CommandError(400, `permission mode must be one of ${PERMISSION_MODES.join(', ')}`);
  return m as PermissionMode;
}

/** Validate and normalise a prompt. A leading '-' would be parsed as a CLI flag, so it is prefixed. */
export function validatePrompt(prompt: unknown): string {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new CommandError(400, 'prompt is required');
  if (prompt.length > PROMPT_MAX) throw new CommandError(400, `prompt is longer than ${PROMPT_MAX} characters`);
  return /^\s*-/.test(prompt) ? `Task:\n${prompt}` : prompt;
}

export function validateBgId(id: string): string {
  if (!BG_ID_RE.test(id)) throw new CommandError(400, 'invalid session id');
  return id;
}

function run(args: string[], cwd: string): Promise<{ code: number; output: string }> {
  const r = resolveClaudeBin();
  if (!r) return Promise.reject(new CommandError(500, 'Claude CLI not found (set CLAUDE_BIN)'));
  if (running >= MAX_CONCURRENT) return Promise.reject(new CommandError(429, 'too many commands running, try again shortly'));
  running++;
  return new Promise((resolve) => {
    // Argument array, no shell: the prompt is never interpreted by cmd.exe.
    execFile(r.bin, [...r.prefix, ...args], { cwd, timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as NodeJS.ErrnoException).code === 'number' ? Number((err as NodeJS.ErrnoException).code) : 1) : 0;
      running--;
      resolve({ code, output: `${stdout}${stderr}`.trim() });
    });
  });
}

function toResult(r: { code: number; output: string }): CommandResult {
  const trust = /Workspace not trusted/i.test(r.output);
  const id = r.output.match(/\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i)?.[1]
    ?? r.output.match(/^\s*([A-Za-z0-9][A-Za-z0-9_-]{3,63})\s*$/m)?.[1];
  return {
    ok: r.code === 0 && !trust,
    output: r.output,
    ...(r.code === 0 && id ? { id } : {}),
    ...(trust ? { needsTrust: 'Open a terminal in this folder, run `claude` once and accept the trust prompt, then retry.' } : {}),
  };
}

export function audit(entry: Record<string, unknown>) {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    appendFileSync(join(DATA_DIR, 'commands.log'), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  } catch {
    // auditing must never take the server down
  }
}

export async function startTask(cwd: string, prompt: string, mode: PermissionMode): Promise<CommandResult> {
  return toResult(await run(['--bg', '--permission-mode', mode, prompt], cwd));
}

export async function continueSession(sessionId: string, cwd: string, prompt: string, mode: PermissionMode): Promise<CommandResult> {
  if (!UUID_RE.test(sessionId)) throw new CommandError(400, 'invalid session id');
  return toResult(await run(['--bg', '--resume', sessionId, '--permission-mode', mode, prompt], cwd));
}

/**
 * `claude stop/logs` look a job up by its 8-hex job id (the first block of the session UUID) and
 * match ids the argument is a prefix of, so a full UUID never matches. Shorten it to the job id.
 */
function jobId(id: string): string {
  return UUID_RE.test(id) ? id.slice(0, 8).toLowerCase() : validateBgId(id);
}

export async function stopSession(id: string, cwd: string): Promise<CommandResult> {
  return toResult(await run(['stop', jobId(id)], cwd));
}

export async function sessionLogs(id: string, cwd: string): Promise<CommandResult> {
  return toResult(await run(['logs', jobId(id)], cwd));
}
