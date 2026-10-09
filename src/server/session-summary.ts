import { open, stat } from 'node:fs/promises';
import type { SessionSummary, TokenCounts } from '../shared/types.ts';
import { parseEntries, VIEW_BYTES_MAX } from './transcript-view.ts';

const TOOLS_MAX = 5;
const TARGET_MAX = 60;
const REPLY_MAX = 300;

export type SummaryMode = 'recap';

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

/** Seam for a later model mode: pick the summarizer by mode. */
export function summarize(path: string, mode: SummaryMode, live?: LiveInfo): Promise<SessionSummary> {
  switch (mode) {
    case 'recap':
      return recapSession(path, live);
  }
}
