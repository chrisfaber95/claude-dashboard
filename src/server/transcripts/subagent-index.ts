import { readFileSync, statSync } from 'node:fs';
import { contentText, handbackBody, peerOrigin, snippet, toolSummary } from './transcript-view.ts';
import { sessionAgg } from './transcript-aggregates.ts';
import type { SubagentInfo } from '../../shared/types/index.ts';

/** What the dashboard knows about one subagent transcript. */
export interface SubagentRecord {
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

interface HandBack {
  tsMs: number;
  result: string;
}

const MINUTE_MS = 60_000;
const STALE_MS = 5 * MINUTE_MS;
const RECENT_MS = 15 * MINUTE_MS;
const RESUME_SLACK_MS = 10_000;
const PER_SESSION_MAX = 24;
/** A subagent meta file is a few hundred bytes; anything bigger is ignored. */
const META_MAX_BYTES = 64 * 1024;
const META_MAX_TRIES = 30;
const AGENT_TYPE_MAX_CHARS = 80;
const DESCRIPTION_MAX_CHARS = 160;
const PROMPT_MAX_CHARS = 300;
const RESULT_MAX_CHARS = 300;
const ACTIVITY_MAX_CHARS = 70;
const SPAWN_TOOL_NAMES = ['Agent', 'Task'];
const SUBAGENT_FILE_PATTERN = /agent-([A-Za-z0-9_-]+)\.jsonl$/;
const SUBAGENT_DIR_PATTERN = /[\\/]subagents[\\/]/;

const subagentRecords = new Map<string, SubagentRecord>();
/** Subagent transcript path per agent id, for the viewer. */
export const subagentPaths = new Map<string, string>();
const spawns = new Map<string, Spawn>();
/** agentId -> tool_use id, from the Agent tool result (fallback when the meta file is missing). */
const agentToolUse = new Map<string, string>();
const handedBack = new Map<string, HandBack>();

/** Drop all subagent state so the next scan starts from scratch. */
export function resetSubagents(): void {
  subagentRecords.clear();
  subagentPaths.clear();
  spawns.clear();
  agentToolUse.clear();
  handedBack.clear();
}

/** Whether a transcript path is a subagent transcript (under a `subagents` folder). */
export function isSubagentPath(filePath: string): boolean {
  return filePath.includes('\\subagents\\') || filePath.includes('/subagents/');
}

/** The session id a subagent transcript belongs to: the folder above its `subagents` folder. */
export function parentSessionIdOf(filePath: string): string {
  return filePath.split(SUBAGENT_DIR_PATTERN)[0].split(/[\\/]/).pop() ?? '';
}

/** Where a transcript line was found, enough to create or update a subagent record. */
export interface SubagentLocation {
  filePath: string;
  project: string;
  tsMs: number;
  /** Agent id cached on the file state, filled from the file name on first use. */
  agentId: string;
}

/**
 * Find or create the record of the subagent that owns a transcript file, and widen its time range.
 * Returns the agent id used (so the caller can cache it) alongside the record.
 */
export function registerSubagent(location: SubagentLocation): { agentId: string; record: SubagentRecord | null } {
  const { filePath, project, tsMs } = location;
  const agentId = location.agentId || (filePath.match(SUBAGENT_FILE_PATTERN)?.[1] ?? '');
  if (!agentId) return { agentId, record: null };
  let record = subagentRecords.get(agentId);
  if (!record) {
    record = {
      agentId,
      sessionId: parentSessionIdOf(filePath),
      project,
      path: filePath,
      agentType: '',
      description: '',
      toolUseId: '',
      metaLoaded: false,
      metaTries: 0,
      background: false,
      startedAtMs: Number.isNaN(tsMs) ? Date.now() : tsMs,
      lastTsMs: Number.isNaN(tsMs) ? 0 : tsMs,
      tokens: 0,
      activity: '',
    };
    subagentRecords.set(agentId, record);
    subagentPaths.set(agentId, filePath);
  }
  if (!Number.isNaN(tsMs)) {
    if (tsMs > record.lastTsMs) record.lastTsMs = tsMs;
    if (tsMs < record.startedAtMs) record.startedAtMs = tsMs;
  }
  return { agentId, record };
}

/** The .meta.json next to a subagent transcript (agent type, description, tool_use id). It can appear a moment after the transcript. */
function loadMeta(record: SubagentRecord): void {
  if (record.metaLoaded || record.metaTries >= META_MAX_TRIES) return;
  record.metaTries++;
  try {
    const metaPath = record.path.replace(/\.jsonl$/, '.meta.json');
    if (statSync(metaPath).size > META_MAX_BYTES) return;
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    record.agentType = snippet(String(meta.agentType ?? ''), AGENT_TYPE_MAX_CHARS);
    record.description = snippet(String(meta.description ?? ''), DESCRIPTION_MAX_CHARS);
    record.toolUseId = String(meta.toolUseId ?? '');
    record.background = meta.requestShape === 'background';
    record.metaLoaded = true;
  } catch {
    // not written yet, or caught mid-write: retry on a later state build
  }
}

/** Agent tool calls on an assistant line, and the current activity of the subagent that wrote it. */
function trackToolCalls(line: any, subagent: SubagentRecord | null, tsMs: number): void {
  const content = line.message?.content;
  if (line.type !== 'assistant' || !Array.isArray(content)) return;
  for (const part of content) {
    if (part?.type !== 'tool_use') continue;
    if (SPAWN_TOOL_NAMES.includes(part.name)) {
      spawns.set(String(part.id), {
        tsMs,
        agentType: snippet(String(part.input?.subagent_type ?? ''), AGENT_TYPE_MAX_CHARS),
        description: snippet(String(part.input?.description ?? ''), DESCRIPTION_MAX_CHARS),
        prompt: snippet(String(part.input?.prompt ?? ''), PROMPT_MAX_CHARS),
        background: Boolean(part.input?.run_in_background),
        byAgentId: subagent ? subagent.agentId : null,
      });
    }
    if (subagent) subagent.activity = toolSummary(String(part.name), part.input, ACTIVITY_MAX_CHARS);
  }
}

/** Agent tool results on a user line: which tool_use started which agent, and its finished report. */
function trackToolResults(line: any, tsMs: number): void {
  const content = line.message?.content;
  if (line.type !== 'user' || !Array.isArray(content)) return;
  const toolResult = line.toolUseResult;
  const agentId = toolResult && typeof toolResult === 'object' && typeof toolResult.agentId === 'string' ? toolResult.agentId : '';
  if (!agentId) return;
  for (const part of content) {
    if (part?.type !== 'tool_result') continue;
    agentToolUse.set(agentId, String(part.tool_use_id));
    if (toolResult.status === 'completed') {
      handedBack.set(agentId, { tsMs, result: snippet(contentText(toolResult.content), RESULT_MAX_CHARS) });
    }
  }
}

/** Background subagents hand back through a peer message whose sender is the subagent itself. */
function trackPeerHandBack(line: any, tsMs: number): void {
  const peer = peerOrigin(line);
  if (!peer?.senderTaskId) return;
  const body = String(peer.body ?? contentText(line.message?.content));
  handedBack.set(String(peer.senderTaskId), { tsMs, result: snippet(handbackBody(body), RESULT_MAX_CHARS) });
}

/** The completion notice names the finished task; it carries no report, so it never replaces one. */
function trackCompletionNotice(line: any, tsMs: number): void {
  const notice = line.type === 'attachment' && typeof line.attachment?.prompt === 'string' ? line.attachment.prompt : '';
  if (!notice.startsWith('<task-notification>')) return;
  const taskId = notice.match(/<task-id>([A-Za-z0-9_-]+)<\/task-id>/)?.[1];
  if (taskId && !handedBack.has(taskId)) handedBack.set(taskId, { tsMs, result: '' });
}

/** Agent tool calls (what was handed down), their results (what came back) and a subagent's current activity. */
export function trackSubagents(line: any, subagent: SubagentRecord | null, tsMs: number): void {
  trackToolCalls(line, subagent, tsMs);
  trackToolResults(line, tsMs);
  trackPeerHandBack(line, tsMs);
  trackCompletionNotice(line, tsMs);
}

function toSubagentInfo(record: SubagentRecord, now: number): SubagentInfo | null {
  // A subagent that was resumed after handing back writes new lines later than the hand-back.
  const found = handedBack.get(record.agentId);
  const back = found && record.lastTsMs <= found.tsMs + RESUME_SLACK_MS ? found : undefined;
  const state = !back && now - record.lastTsMs < STALE_MS ? 'working' : 'done';
  if (state === 'done' && now - (back?.tsMs ?? record.lastTsMs) > RECENT_MS) return null;
  loadMeta(record);
  const spawn = spawns.get(record.toolUseId || agentToolUse.get(record.agentId) || '');
  return {
    agentId: record.agentId,
    sessionId: record.sessionId,
    // The parent session's project, so the building and the project cards agree.
    project: sessionAgg.get(record.sessionId)?.project ?? record.project,
    agentType: record.agentType || spawn?.agentType || 'agent',
    description: record.description || spawn?.description || '',
    prompt: spawn?.prompt ?? '',
    background: record.background || Boolean(spawn?.background),
    parentAgentId: spawn?.byAgentId && spawn.byAgentId !== record.agentId ? spawn.byAgentId : null,
    startedAtMs: spawn?.tsMs ?? record.startedAtMs,
    lastTsMs: record.lastTsMs,
    state,
    handedBack: Boolean(back),
    activity: state === 'working' ? record.activity : '',
    result: back?.result ?? '',
    tokens: record.tokens,
  };
}

/** Subagents of the given live sessions that are working, or finished within the last 15 minutes. */
export function buildSubagents(liveSessionIds: Set<string>, now: number): SubagentInfo[] {
  const infos: SubagentInfo[] = [];
  for (const record of subagentRecords.values()) {
    if (!liveSessionIds.has(record.sessionId)) continue;
    const info = toSubagentInfo(record, now);
    if (info) infos.push(info);
  }
  infos.sort((a, b) => a.startedAtMs - b.startedAtMs);
  // Keep the newest few per session, so one runaway session can't flood the state push.
  const perSession = new Map<string, number>();
  return infos
    .reverse()
    .filter((info) => {
      const count = (perSession.get(info.sessionId) ?? 0) + 1;
      perSession.set(info.sessionId, count);
      return count <= PER_SESSION_MAX;
    })
    .reverse();
}
