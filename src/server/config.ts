import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PORT = Number(process.env.DASHBOARD_PORT ?? 4777);
export const HOST = process.env.DASHBOARD_HOST ?? (process.argv.includes('--lan') ? '0.0.0.0' : '127.0.0.1');
/** LAN mode = bound to anything other than loopback: HTTPS + login required. */
export const isLanMode = !['127.0.0.1', 'localhost', '::1'].includes(HOST);
export const canRunCommands = process.env.DASHBOARD_COMMANDS !== '0';
export const PROJECTS_ROOT = process.env.PROJECTS_ROOT ?? 'N:\\Projects';
export const TEAM_HQ_DIR = process.env.TEAM_HQ_DIR ?? 'N:\\team-hq';
// Claude Code moves its whole data folder, `.claude.json` included, when CLAUDE_CONFIG_DIR is set; follow it.
const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR;
export const CLAUDE_DIR = process.env.CLAUDE_DIR ?? CONFIG_DIR ?? join(homedir(), '.claude');
export const CLAUDE_JSON = process.env.CLAUDE_JSON ?? (CONFIG_DIR ? join(CONFIG_DIR, '.claude.json') : join(homedir(), '.claude.json'));
export const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** Secrets (login token, TLS key) and the audit log. Never served. */
export const DATA_DIR = process.env.DASHBOARD_DATA_DIR ?? join(APP_ROOT, '.dashboard');

/** Mirror Claude Code's transcript folder naming: every non-alphanumeric char becomes '-'. */
export function cwdSlug(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

export function normPath(path: string): string {
  return path.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

export function emptyTokens() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

export function localDay(ms: number): string {
  const date = new Date(ms);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
