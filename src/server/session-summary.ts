import { open, stat } from 'node:fs/promises';
import type { SessionSummary, SummaryMode, TokenCounts } from '../shared/types.ts';
import { summarizeWithModel } from './claude-cli.ts';
import { parseEntries, VIEW_BYTES_MAX } from './transcript-view.ts';

const TOOLS_MAX = 5;
const TARGET_MAX = 60;
const REPLY_MAX = 300;

export const EXCERPT_MAX = 20_000;
export const MODEL_FALLBACK_NOTE = 'The model summary was not available, so this is the recap.';

export interface LiveInfo {
  status: string;
  startedAtMs: number;
}

function cut(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/** Masks likely secrets (bearer tokens, key=value, URL userinfo and query) before a target is cut. */
function redact(s: string): string {
  return s
    .replace(/(\b(?:bearer|basic)\s+)\S+/gi, '$1***')
    .replace(/(\b[\w-]*(?:token|secret|key|password|passwd|auth)[\w-]*\s*[=:]\s*)\S+/gi, '$1***')
    .replace(/(--?[\w-]*(?:token|secret|key|password|auth)[\w-]*[ =])\S+/gi, '$1***')
    .replace(/(\w+:\/\/)[^/\s@]*@/g, '$1')
    .replace(/\?\S*/g, (m) => (/^\?[\w%.~-]+=/.test(m) ? '?***' : m));
}

/** Stricter than redact(): also masks well-known token shapes, because this text leaves the machine. */
export function redactForModel(s: string): string {
  return redact(s)
    .replace(/-----BEGIN [A-Z ]*-----[\s\S]*?(?:-----END [A-Z ]*-----|$)/g, '***')
    .replace(/\b(?:sk|pk|ghp|gho|xox[abp])[-_][\w-]{16,}/g, '***')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '***')
    .replace(/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*/g, '***');
}

/** Tool name plus a short target only: tool inputs can hold secrets or long text. */
function toolAction(name: string, input: any): string {
  if (input && typeof input === 'object') {
    if (typeof input.command === 'string') return `${name}: ${cut(redact(input.command), TARGET_MAX)}`;
    const target = input.file_path ?? input.notebook_path ?? input.path ?? input.pattern ?? input.url;
    if (typeof target === 'string') return `${name} ${cut(redact(target), TARGET_MAX)}`;
  }
  return name;
}

function when(ms: number): string {
  return ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : 'unknown';
}

async function tailLines(path: string, maxBytes: number): Promise<string[]> {
  const st = await stat(path);
  const start = Math.max(0, st.size - maxBytes);
  const buf = Buffer.alloc(st.size - start);
  const fh = await open(path, 'r');
  try {
    await fh.read(buf, 0, buf.length, start);
  } finally {
    await fh.close();
  }
  const lines = buf.toString('utf8').split('\n');
  if (start > 0) lines.shift(); // first line is partial
  return lines;
}

/** No-model recap of the tail of a transcript (the same tail the viewer reads). */
export async function recapSession(path: string, live?: LiveInfo, maxBytes = VIEW_BYTES_MAX): Promise<SessionSummary> {
  const lines = await tailLines(path, maxBytes);
  const tokens: TokenCounts = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const seen = new Set<string>();
  const actions: string[] = [];
  let firstMs = 0;
  let lastMs = 0;
  for (const raw of lines) {
    if (!raw) continue;
    let o: any;
    try {
      o = JSON.parse(raw);
    } catch {
      continue;
    }
    if (o.isMeta || o.isSidechain) continue;
    const ms = o.timestamp ? Date.parse(o.timestamp) : 0;
    if (ms) {
      if (!firstMs) firstMs = ms;
      lastMs = Math.max(lastMs, ms);
    }
    if (o.type !== 'assistant' || !o.message) continue;
    const u = o.message.usage;
    const key = `${o.message.id ?? ''}:${o.requestId ?? ''}`;
    if (u && typeof u === 'object' && !(key !== ':' && seen.has(key))) {
      seen.add(key);
      tokens.input += Number(u.input_tokens) || 0;
      tokens.output += Number(u.output_tokens) || 0;
      tokens.cacheRead += Number(u.cache_read_input_tokens) || 0;
      tokens.cacheWrite += Number(u.cache_creation_input_tokens) || 0;
    }
    if (Array.isArray(o.message.content)) {
      for (const c of o.message.content) if (c?.type === 'tool_use') actions.push(toolAction(String(c.name), c.input));
    }
  }
  const lastReply = parseEntries(lines).filter((e) => e.role === 'assistant').pop()?.text ?? '';
  const started = live?.startedAtMs || firstMs;
  const status = live?.status ?? 'not running';
  const recent = actions.slice(-TOOLS_MAX);
  const total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
  const text = [
    `Started: ${when(started)}`,
    `Last activity: ${when(lastMs)}`,
    `Status: ${status}`,
    `Tokens: ${total.toLocaleString('en-US')} (in ${tokens.input.toLocaleString('en-US')}, out ${tokens.output.toLocaleString('en-US')}, cache read ${tokens.cacheRead.toLocaleString('en-US')}, cache write ${tokens.cacheWrite.toLocaleString('en-US')})`,
    recent.length ? `Last actions:\n${recent.map((a) => `- ${a}`).join('\n')}` : 'Last actions: none',
    lastReply ? `Last reply: ${cut(lastReply, REPLY_MAX)}` : 'Last reply: none',
  ].join('\n');
  return { mode: 'recap', text };
}

/** The newest transcript text (user and assistant turns only), secrets masked, at most `max` characters. */
export async function excerptSession(path: string, max = EXCERPT_MAX, maxBytes = VIEW_BYTES_MAX): Promise<string> {
  const entries = parseEntries(await tailLines(path, maxBytes)).filter((e) => e.role === 'user' || e.role === 'assistant');
  const parts: string[] = [];
  let size = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const part = `${entries[i].role}: ${redactForModel(entries[i].text.slice(0, max * 4))}`.slice(0, max);
    if (size + part.length + 2 > max) break;
    parts.unshift(part);
    size += part.length + 2;
  }
  return parts.join('\n\n');
}

/** What a model summary needs besides the transcript: the folder to run in and an audit hook. */
export interface ModelContext {
  cwd: string;
  onAudit: (ok: boolean) => void;
}

export const COOLDOWN_NOTE = 'A model summary was made a moment ago, so this is the recap.';
export const SUMMARY_COOLDOWN_MS = 60_000;
export const SUMMARY_CACHE_MAX = 50;

/** Per session: the transcript state the answer was made for, when the last model call started, and the answer only (no transcript text). */
interface CacheEntry {
  size: number;
  mtimeMs: number;
  at: number;
  text: string;
}
const cache = new Map<string, CacheEntry>();
let clock: () => number = Date.now;

/** Empties the in-memory cache; tests pass a fake clock. */
export function resetSummaryCache(now: () => number = Date.now): void {
  cache.clear();
  clock = now;
}

function remember(key: string, entry: CacheEntry): void {
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > SUMMARY_CACHE_MAX) cache.delete(cache.keys().next().value as string);
}

/** Recap, or in `model` mode one cheap-model call over the transcript excerpt, cached per session; any failure returns the recap plus a fixed note. */
export async function summarize(path: string, mode: SummaryMode, live?: LiveInfo, model?: ModelContext): Promise<SessionSummary> {
  if (mode === 'model' && model) {
    const st = await stat(path);
    const prev = cache.get(path);
    if (prev?.text && prev.size === st.size && prev.mtimeMs === st.mtimeMs) return { mode: 'model', text: prev.text };
    if (prev && clock() - prev.at < SUMMARY_COOLDOWN_MS) {
      if (prev.text) return { mode: 'model', text: prev.text };
      return { ...(await recapSession(path, live)), note: COOLDOWN_NOTE };
    }
    const at = clock();
    let text = '';
    try {
      text = await summarizeWithModel(await excerptSession(path), model.cwd);
    } catch {
      // fall through to the recap
    }
    model.onAudit(Boolean(text));
    if (text) {
      text = redactForModel(text);
      remember(path, { size: st.size, mtimeMs: st.mtimeMs, at, text });
      return { mode: 'model', text };
    }
    remember(path, { size: st.size, mtimeMs: st.mtimeMs, at, text: prev?.text ?? '' });
    return { ...(await recapSession(path, live)), note: MODEL_FALLBACK_NOTE };
  }
  return recapSession(path, live);
}
