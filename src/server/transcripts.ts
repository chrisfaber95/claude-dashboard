import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CLAUDE_DIR, PROJECTS_ROOT, emptyTokens, localDay, normPath } from './config.ts';
import { toolSummary } from './transcript-view.ts';
import type { LimitHit, MessageInfo, SubagentInfo, TokenCounts } from '../shared/types.ts';

interface FileState {
  offset: number;
  /** Trailing partial line carried to the next read. */
  carry: Buffer;
  sessionId: string;
  cwd: string;
  branch: string | null;
  /** Set for subagent transcripts (agent-<id>.jsonl). */
  agentId: string;
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

interface SubagentRec {
  agentId: string;
  sessionId: string;
  project: string;
  path: string;
  agentType: string;
  description: string;
  toolUseId: string;
  metaLoaded: boolean;
  metaTries: number;
  background: boolean;
  startedAtMs: number;
  lastTsMs: number;
  tokens: number;
  activity: string;
}

/** What a spawner handed down: one entry per Agent tool call, keyed by tool_use id. */
interface Spawn {
  tsMs: number;
  agentType: string;
  description: string;
  prompt: string;
  background: boolean;
  /** Subagent that made the call; null for the main session. */
  byAgentId: string | null;
}

/** A subagent meta file is a few hundred bytes; anything bigger is ignored. */
const META_MAX = 64 * 1024;
const subagentRecs = new Map<string, SubagentRec>();
/** Subagent transcript path per agent id, for the viewer. */
export const subagentPaths = new Map<string, string>();
const spawns = new Map<string, Spawn>();
/** agentId -> tool_use id, from the Agent tool result (fallback when the meta file is missing). */
const agentToolUse = new Map<string, string>();
const handedBack = new Map<string, { tsMs: number; result: string }>();

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
  subagentRecs.clear();
  subagentPaths.clear();
  spawns.clear();
  agentToolUse.clear();
  handedBack.clear();
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

/** The report inside a "[Subagent hand-back]" body, without the harness preamble. */
function handbackBody(body: string): string {
  return body.replace(/^\[Subagent hand-back\][\s\S]*?The report follows:\s*/, '').replace(/^\[Subagent hand-back\][^:]*:\s*/, '');
}

function subagentRec(st: FileState, filePath: string, sessionId: string, project: string, ts: number): SubagentRec | null {
  if (!st.agentId) st.agentId = filePath.match(/agent-([A-Za-z0-9_-]+)\.jsonl$/)?.[1] ?? '';
  if (!st.agentId) return null;
  let rec = subagentRecs.get(st.agentId);
  if (!rec) {
    const parent = filePath.split(/[\\/]subagents[\\/]/)[0].split(/[\\/]/).pop() ?? sessionId;
    rec = {
      agentId: st.agentId,
      sessionId: parent,
      project,
      path: filePath,
      agentType: '',
      description: '',
      toolUseId: '',
      metaLoaded: false,
      metaTries: 0,
      background: false,
      startedAtMs: Number.isNaN(ts) ? Date.now() : ts,
      lastTsMs: Number.isNaN(ts) ? 0 : ts,
      tokens: 0,
      activity: '',
    };
    subagentRecs.set(st.agentId, rec);
    subagentPaths.set(st.agentId, filePath);
  }
  if (!Number.isNaN(ts)) {
    if (ts > rec.lastTsMs) rec.lastTsMs = ts;
    if (ts < rec.startedAtMs) rec.startedAtMs = ts;
  }
  return rec;
}

/** The .meta.json next to a subagent transcript (agent type, description, tool_use id). It can appear a moment after the transcript. */
function loadMeta(rec: SubagentRec) {
  if (rec.metaLoaded || rec.metaTries >= 30) return;
  rec.metaTries++;
  try {
    const metaPath = rec.path.replace(/\.jsonl$/, '.meta.json');
    if (statSync(metaPath).size > META_MAX) return;
    const m = JSON.parse(readFileSync(metaPath, 'utf8'));
    rec.agentType = snippet(String(m.agentType ?? ''), 80);
    rec.description = snippet(String(m.description ?? ''), 160);
    rec.toolUseId = String(m.toolUseId ?? '');
    rec.background = m.requestShape === 'background';
    rec.metaLoaded = true;
  } catch {
    // not written yet, or caught mid-write: retry on a later state build
  }
}

/** Agent tool calls (what was handed down), their results (what came back) and a subagent's current activity. */
function trackSubagents(o: any, sub: SubagentRec | null, ts: number) {
  const content = o.message?.content;
  if (o.type === 'assistant' && Array.isArray(content)) {
    for (const c of content) {
      if (c?.type !== 'tool_use') continue;
      if (c.name === 'Agent' || c.name === 'Task') {
        spawns.set(String(c.id), {
          tsMs: ts,
          agentType: snippet(String(c.input?.subagent_type ?? ''), 80),
          description: snippet(String(c.input?.description ?? ''), 160),
          prompt: snippet(String(c.input?.prompt ?? ''), 300),
          background: Boolean(c.input?.run_in_background),
          byAgentId: sub ? sub.agentId : null,
        });
      }
      if (sub) sub.activity = toolSummary(String(c.name), c.input, 70);
    }
  }
  if (o.type === 'user' && Array.isArray(content)) {
    const r = o.toolUseResult;
    const agentId = r && typeof r === 'object' && typeof r.agentId === 'string' ? r.agentId : '';
    for (const c of content) {
      if (c?.type !== 'tool_result' || !agentId) continue;
      agentToolUse.set(agentId, String(c.tool_use_id));
      if (r.status === 'completed') handedBack.set(agentId, { tsMs: ts, result: snippet(contentText(r.content), 300) });
    }
  }
  // Background subagents hand back through a peer message whose sender is the subagent itself.
  const peer = peerOrigin(o);
  if (peer?.senderTaskId) {
    const body = String(peer.body ?? contentText(content));
    handedBack.set(String(peer.senderTaskId), { tsMs: ts, result: snippet(handbackBody(body), 300) });
  }
  // The completion notice names the finished task; it carries no report, so it never replaces one.
  const notice = o.type === 'attachment' && typeof o.attachment?.prompt === 'string' ? o.attachment.prompt : '';
  if (notice.startsWith('<task-notification>')) {
    const id = notice.match(/<task-id>([A-Za-z0-9_-]+)<\/task-id>/)?.[1];
    if (id && !handedBack.has(id)) handedBack.set(id, { tsMs: ts, result: '' });
  }
}

/** The peer origin of a line: on the user line itself, or (newer Claude Code) on a queued_command attachment. */
function peerOrigin(o: any): any {
  const origin = o.type === 'user' ? o.origin : o.type === 'attachment' && o.attachment?.type === 'queued_command' ? o.attachment.origin : undefined;
  return origin?.kind === 'peer' ? origin : undefined;
}

const STALE_MS = 5 * 60_000;
const RECENT_MS = 15 * 60_000;
const RESUME_SLACK_MS = 10_000;
const PER_SESSION_MAX = 24;

/** Subagents of the given live sessions that are working, or finished within the last 15 minutes. */
export function buildSubagents(liveSessionIds: Set<string>, now: number): SubagentInfo[] {
  const out: SubagentInfo[] = [];
  for (const rec of subagentRecs.values()) {
    if (!liveSessionIds.has(rec.sessionId)) continue;
    // A subagent that was resumed after handing back writes new lines later than the hand-back.
    const found = handedBack.get(rec.agentId);
    const back = found && rec.lastTsMs <= found.tsMs + RESUME_SLACK_MS ? found : undefined;
    const state = !back && now - rec.lastTsMs < STALE_MS ? 'working' : 'done';
    if (state === 'done' && now - (back?.tsMs ?? rec.lastTsMs) > RECENT_MS) continue;
    loadMeta(rec);
    const spawn = spawns.get(rec.toolUseId || agentToolUse.get(rec.agentId) || '');
    out.push({
      agentId: rec.agentId,
      sessionId: rec.sessionId,
      // The parent session's project, so the building and the project cards agree.
      project: sessionAgg.get(rec.sessionId)?.project ?? rec.project,
      agentType: rec.agentType || spawn?.agentType || 'agent',
      description: rec.description || spawn?.description || '',
      prompt: spawn?.prompt ?? '',
      background: rec.background || Boolean(spawn?.background),
      parentAgentId: spawn?.byAgentId && spawn.byAgentId !== rec.agentId ? spawn.byAgentId : null,
      startedAtMs: spawn?.tsMs ?? rec.startedAtMs,
      lastTsMs: rec.lastTsMs,
      state,
      handedBack: Boolean(back),
      activity: state === 'working' ? rec.activity : '',
      result: back?.result ?? '',
      tokens: rec.tokens,
    });
  }
  out.sort((a, b) => a.startedAtMs - b.startedAtMs);
  // Keep the newest few per session, so one runaway session can't flood the state push.
  const perSession = new Map<string, number>();
  return out
    .reverse()
    .filter((x) => {
      const n = (perSession.get(x.sessionId) ?? 0) + 1;
      perSession.set(x.sessionId, n);
      return n <= PER_SESSION_MAX;
    })
    .reverse();
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

  const sub = isSub ? subagentRec(st, filePath, sid, project, ts) : null;

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
        if (sub) sub.tokens += total;
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

  trackSubagents(o, sub, ts);

  if (isSub || Number.isNaN(ts)) return;

  if (st.sessionId && st.cwd) {
    const prev = transcriptIndex.get(st.sessionId);
    if (!prev || ts >= prev.lastTsMs) transcriptIndex.set(st.sessionId, { path: filePath, cwd: st.cwd, project, lastTsMs: ts });
  }

  // Incoming peer messages.
  const peer = peerOrigin(o);
  if (peer) {
    const body = String(peer.body ?? contentText(o.message?.content));
    const subagent = body.startsWith('[Subagent hand-back]') || Boolean(peer.senderTaskId);
    messages.push({
      tsMs: ts,
      kind: subagent ? 'subagent' : 'session',
      direction: 'in',
      sessionId: sid,
      sessionName: '',
      peer: String(peer.name ?? peer.from ?? 'unknown'),
      snippet: snippet(handbackBody(body)),
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
    if (!st) files.set(f, (st = { offset: 0, carry: Buffer.alloc(0), sessionId: '', cwd: '', branch: null, agentId: '' }));
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
