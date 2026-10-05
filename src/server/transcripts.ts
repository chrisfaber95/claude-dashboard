import { closeSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CLAUDE_DIR, PROJECTS_ROOT, emptyTokens, localDay, normPath } from './config.ts';
import type { LimitHit, MessageInfo, TokenCounts } from '../shared/types.ts';

interface FileState {
  offset: number;
  /** Trailing partial line carried to the next read. */
  carry: Buffer;
  sessionId: string;
  cwd: string;
  branch: string | null;
}

interface DayAgg {
  tokens: TokenCounts;
  byProject: Record<string, number>;
  byModel: Record<string, number>;
}

export interface SessionAgg {
  tokens: TokenCounts;
  cwd: string;
  branch: string | null;
  lastTsMs: number;
  project: string;
}

const SCAN_CHUNK = 16 * 1024 * 1024;
const files = new Map<string, FileState>();
const seenMessageIds = new Set<string>();
export const sessionAgg = new Map<string, SessionAgg>();
export const dayAgg = new Map<string, DayAgg>();
export const modelTotals: Record<string, number> = {};
export const messages: MessageInfo[] = [];
export const limitHits: LimitHit[] = [];
/** Last activity per project name (ms). */
export const projectLastActive = new Map<string, number>();
/** Main (non-subagent) transcript per session id, for the transcript viewer and --resume. */
export const transcriptIndex = new Map<string, { path: string; cwd: string; project: string; lastTsMs: number }>();

/** Drop all aggregated state so the next scan starts from scratch. */
export function resetTranscripts() {
  files.clear();
  seenMessageIds.clear();
  sessionAgg.clear();
  dayAgg.clear();
  for (const k of Object.keys(modelTotals)) delete modelTotals[k];
  messages.length = 0;
  limitHits.length = 0;
  projectLastActive.clear();
  transcriptIndex.clear();
}

export function projectOf(cwd: string): string {
  const n = normPath(cwd);
  const root = normPath(PROJECTS_ROOT);
  if (n.startsWith(root + '\\')) return cwd.replace(/\//g, '\\').slice(root.length + 1).split('\\')[0];
  return cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd;
}

function* walk(dir: string): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.jsonl')) yield p;
  }
}

function snippet(text: string, max = 220): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : ''))
      .join(' ');
  }
  return '';
}

function handleLine(raw: string, st: FileState, filePath: string) {
  let o: any;
  try {
    o = JSON.parse(raw);
  } catch {
    return;
  }
  const ts = o.timestamp ? Date.parse(o.timestamp) : NaN;
  if (o.sessionId) st.sessionId = o.sessionId;
  if (o.cwd) st.cwd = o.cwd;
  if (o.gitBranch) st.branch = o.gitBranch;
  const sid = st.sessionId || filePath;
  const project = projectOf(st.cwd);
  const isSub = filePath.includes('\\subagents\\') || filePath.includes('/subagents/');

  if (!Number.isNaN(ts)) {
    const prev = projectLastActive.get(project) ?? 0;
    if (ts > prev) projectLastActive.set(project, ts);
  }

  // Token usage (assistant messages). Streamed duplicates share message id + requestId.
  const usage = o.message?.usage;
  if (usage && o.type === 'assistant' && !Number.isNaN(ts)) {
    const key = `${o.message.id ?? ''}:${o.requestId ?? ''}`;
    if (key === ':' || !seenMessageIds.has(key)) {
      if (key !== ':') seenMessageIds.add(key);
      const t: TokenCounts = {
        input: usage.input_tokens ?? 0,
        output: usage.output_tokens ?? 0,
        cacheRead: usage.cache_read_input_tokens ?? 0,
        cacheWrite: usage.cache_creation_input_tokens ?? 0,
      };
      const total = t.input + t.output + t.cacheRead + t.cacheWrite;
      const model: string = o.message.model ?? 'unknown';
      if (model !== '<synthetic>') {
        const day = localDay(ts);
        let d = dayAgg.get(day);
        if (!d) dayAgg.set(day, (d = { tokens: emptyTokens(), byProject: {}, byModel: {} }));
        d.tokens.input += t.input;
        d.tokens.output += t.output;
        d.tokens.cacheRead += t.cacheRead;
        d.tokens.cacheWrite += t.cacheWrite;
        d.byProject[project] = (d.byProject[project] ?? 0) + total;
        d.byModel[model] = (d.byModel[model] ?? 0) + total;
        modelTotals[model] = (modelTotals[model] ?? 0) + total;

        // Subagent transcripts live under the parent session's folder; attribute to the parent.
        const parent = isSub ? (filePath.split(/[\\/]subagents[\\/]/)[0].split(/[\\/]/).pop() ?? sid) : sid;
        let s = sessionAgg.get(parent);
        if (!s) {
          sessionAgg.set(parent, (s = { tokens: emptyTokens(), cwd: st.cwd, branch: st.branch, lastTsMs: 0, project }));
        }
        s.tokens.input += t.input;
        s.tokens.output += t.output;
        s.tokens.cacheRead += t.cacheRead;
        s.tokens.cacheWrite += t.cacheWrite;
        if (!isSub) {
          s.cwd = st.cwd || s.cwd;
          s.branch = st.branch ?? s.branch;
          s.project = project;
        }
        if (ts > s.lastTsMs) s.lastTsMs = ts;
      }
    }
  }

  // Rate-limit rejections.
  if (o.quotaLimits && o.quotaLimits.status === 'rejected' && !Number.isNaN(ts)) {
    limitHits.push({
      tsMs: ts,
      type: String(o.quotaLimits.rateLimitType ?? 'unknown'),
      resetsAtMs: o.quotaLimits.resetsAt ? Number(o.quotaLimits.resetsAt) * 1000 : null,
      project,
    });
  }

  if (isSub || Number.isNaN(ts)) return;

  if (st.sessionId && st.cwd) {
    const prev = transcriptIndex.get(st.sessionId);
    if (!prev || ts >= prev.lastTsMs) transcriptIndex.set(st.sessionId, { path: filePath, cwd: st.cwd, project, lastTsMs: ts });
  }

  // Incoming peer messages.
  if (o.type === 'user' && o.origin?.kind === 'peer') {
    const body = String(o.origin.body ?? contentText(o.message?.content));
    const subagent = body.startsWith('[Subagent hand-back]') || Boolean(o.origin.senderTaskId);
    messages.push({
      tsMs: ts,
      kind: subagent ? 'subagent' : 'session',
      direction: 'in',
      sessionId: sid,
      sessionName: '',
      peer: String(o.origin.from ?? 'unknown'),
      snippet: snippet(body.replace(/^\[Subagent hand-back\][^:]*:\s*/, '')),
    });
  }

  // Outgoing SendMessage calls.
  if (o.type === 'assistant' && Array.isArray(o.message?.content)) {
    for (const c of o.message.content) {
      if (c?.type === 'tool_use' && c.name === 'SendMessage') {
        const msg = c.input?.message;
        messages.push({
          tsMs: ts,
          kind: 'session',
          direction: 'out',
          sessionId: sid,
          sessionName: '',
          peer: String(c.input?.to ?? 'unknown'),
          snippet: snippet(typeof msg === 'string' ? msg : JSON.stringify(msg ?? '')),
        });
      }
    }
  }
}

/** Incrementally read new bytes from every transcript. Read-only. */
export function scanTranscripts() {
  const root = join(CLAUDE_DIR, 'projects');
  for (const f of walk(root)) {
    let size: number;
    try {
      size = statSync(f).size;
    } catch {
      continue;
    }
    let st = files.get(f);
    if (!st) files.set(f, (st = { offset: 0, carry: Buffer.alloc(0), sessionId: '', cwd: '', branch: null }));
    if (size < st.offset) {
      // truncated/rotated
      st.offset = 0;
      st.carry = Buffer.alloc(0);
    }
    if (size === st.offset) continue;
    let fd: number;
    try {
      fd = openSync(f, 'r');
    } catch {
      continue;
    }
    try {
      // Bounded chunks, so one huge transcript can't exhaust memory.
      while (st.offset < size) {
        const buf = Buffer.alloc(Math.min(SCAN_CHUNK, size - st.offset));
        const n = readSync(fd, buf, 0, buf.length, st.offset);
        if (n <= 0) break;
        st.offset += n;
        let data = Buffer.concat([st.carry, buf.subarray(0, n)]);
        let nl: number;
        while ((nl = data.indexOf(10)) !== -1) {
          const line = data.subarray(0, nl).toString('utf8');
          data = data.subarray(nl + 1);
          if (line) handleLine(line, st, f);
        }
        // A single line longer than the chunk size is dropped rather than buffered forever.
        st.carry = data.length > SCAN_CHUNK ? Buffer.alloc(0) : Buffer.from(data);
      }
    } catch {
      // unreadable right now (locked or being rewritten); the next scan retries from st.offset
    } finally {
      closeSync(fd);
    }
  }
}
