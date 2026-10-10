import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface Fixture {
  root: string;
  claudeDir: string;
  projectsRoot: string;
  claudeJson: string;
  dataDir: string;
}

/**
 * Create an isolated fake ~/.claude + projects tree and point the dashboard's env at it.
 * Must run before the server modules are imported, since they read env at load time.
 */
export function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'claude-dash-'));
  const claudeDir = join(root, '.claude');
  const projectsRoot = join(root, 'Projects');
  const claudeJson = join(root, '.claude.json');
  const dataDir = join(root, '.dashboard');
  mkdirSync(join(claudeDir, 'projects'), { recursive: true });
  mkdirSync(join(claudeDir, 'sessions'), { recursive: true });
  mkdirSync(projectsRoot, { recursive: true });
  process.env.CLAUDE_DIR = claudeDir;
  process.env.PROJECTS_ROOT = projectsRoot;
  process.env.CLAUDE_JSON = claudeJson;
  process.env.DASHBOARD_DATA_DIR = dataDir;
  return { root, claudeDir, projectsRoot, claudeJson, dataDir };
}

export function slug(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, '-');
}

/** Path of the transcript folder for a cwd inside the fixture. */
export function transcriptDir(fx: Fixture, cwd: string): string {
  const directory = join(fx.claudeDir, 'projects', slug(cwd));
  mkdirSync(directory, { recursive: true });
  return directory;
}

export function jsonl(lines: object[]): string {
  return lines.map((line) => JSON.stringify(line)).join('\n') + '\n';
}

export function assistantLine(opts: {
  sessionId: string;
  cwd: string;
  ts: string;
  id: string;
  requestId?: string;
  model?: string;
  usage?: Partial<Record<'input_tokens' | 'output_tokens' | 'cache_read_input_tokens' | 'cache_creation_input_tokens', number>>;
  content?: unknown[];
  gitBranch?: string;
}) {
  return {
    type: 'assistant',
    sessionId: opts.sessionId,
    cwd: opts.cwd,
    timestamp: opts.ts,
    gitBranch: opts.gitBranch,
    requestId: opts.requestId ?? `req_${opts.id}`,
    message: {
      id: opts.id,
      role: 'assistant',
      model: opts.model ?? 'claude-sonnet-5-5',
      content: opts.content ?? [{ type: 'text', text: 'ok' }],
      usage: opts.usage ?? { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40 },
    },
  };
}

export function writeFile(path: string, content: string) {
  writeFileSync(path, content);
}

export interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** Low-level request so tests control Host/Origin/Cookie exactly and paths aren't normalised. */
export function raw(
  port: number,
  opts: { method?: string; path: string; headers?: Record<string, string>; body?: string; https?: boolean },
): Promise<RawResponse> {
  const fn = opts.https ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = fn(
      { host: '127.0.0.1', port, path: opts.path, method: opts.method ?? 'GET', headers: opts.headers, rejectUnauthorized: false },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}
