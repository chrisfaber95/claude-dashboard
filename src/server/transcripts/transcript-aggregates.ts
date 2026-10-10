import { PROJECTS_ROOT, emptyTokens, localDay, normPath } from '../config.ts';
import { contentText, handbackBody, peerName, peerOrigin, snippet } from './transcript-view.ts';
import type { LimitHit, MessageInfo, TokenCounts } from '../../shared/types/index.ts';

/** Tokens per local day, split by project and model. */
export interface DayAgg {
  tokens: TokenCounts;
  byProject: Record<string, number>;
  byModel: Record<string, number>;
}

/** Tokens and last known location of one session (subagent usage is attributed to the parent). */
export interface SessionAgg {
  tokens: TokenCounts;
  cwd: string;
  branch: string | null;
  lastTsMs: number;
  project: string;
}

/** The main (non-subagent) transcript of one session. */
export interface TranscriptLocation {
  path: string;
  cwd: string;
  project: string;
  lastTsMs: number;
}

/** Where a usage record belongs: the session it is attributed to and the file's current cwd and branch. */
export interface UsageContext {
  project: string;
  /** Session the tokens are attributed to (the parent session for subagent transcripts). */
  sessionId: string;
  cwd: string;
  branch: string | null;
  isSubagentFile: boolean;
}

const MS_PER_SECOND = 1000;
const SYNTHETIC_MODEL = '<synthetic>';
/** Key of a streamed message that has neither message id nor request id: it cannot be de-duplicated. */
const EMPTY_MESSAGE_KEY = ':';
const SNIPPET_MAX_CHARS = 220;

const seenMessageIds = new Set<string>();
/** Tokens, cwd and branch per session id. */
export const sessionAgg = new Map<string, SessionAgg>();
/** Tokens per local day. */
export const dayAgg = new Map<string, DayAgg>();
/** Tokens per model over all days. */
export const modelTotals: Record<string, number> = {};
/** Peer messages and SendMessage calls, in file order. */
export const messages: MessageInfo[] = [];
/** Rate-limit rejections seen in transcripts. */
export const limitHits: LimitHit[] = [];
/** Last activity per project name (ms). */
export const projectLastActive = new Map<string, number>();
/** Main (non-subagent) transcript per session id, for the transcript viewer and --resume. */
export const transcriptIndex = new Map<string, TranscriptLocation>();

/** Drop all aggregated state so the next scan starts from scratch. */
export function resetAggregates(): void {
  seenMessageIds.clear();
  sessionAgg.clear();
  dayAgg.clear();
  for (const model of Object.keys(modelTotals)) delete modelTotals[model];
  messages.length = 0;
  limitHits.length = 0;
  projectLastActive.clear();
  transcriptIndex.clear();
}

/** The project a working directory belongs to: its folder under PROJECTS_ROOT, else its last path segment. */
export function projectOf(cwd: string): string {
  const normalized = normPath(cwd);
  const root = normPath(PROJECTS_ROOT);
  if (normalized.startsWith(root + '\\')) return cwd.replace(/\//g, '\\').slice(root.length + 1).split('\\')[0];
  return cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd;
}

function addTokens(target: TokenCounts, tokens: TokenCounts): void {
  target.input += tokens.input;
  target.output += tokens.output;
  target.cacheRead += tokens.cacheRead;
  target.cacheWrite += tokens.cacheWrite;
}

/** Remember the newest timestamp seen for a project. */
export function noteProjectActivity(project: string, tsMs: number): void {
  const previous = projectLastActive.get(project) ?? 0;
  if (tsMs > previous) projectLastActive.set(project, tsMs);
}

function dayAggFor(day: string): DayAgg {
  let aggregate = dayAgg.get(day);
  if (!aggregate) {
    aggregate = { tokens: emptyTokens(), byProject: {}, byModel: {} };
    dayAgg.set(day, aggregate);
  }
  return aggregate;
}

function sessionAggFor(context: UsageContext): SessionAgg {
  let aggregate = sessionAgg.get(context.sessionId);
  if (!aggregate) {
    aggregate = { tokens: emptyTokens(), cwd: context.cwd, branch: context.branch, lastTsMs: 0, project: context.project };
    sessionAgg.set(context.sessionId, aggregate);
  }
  return aggregate;
}

/** True once per streamed message: duplicates share message id + request id. */
function isFirstSighting(line: any): boolean {
  const key = `${line.message.id ?? ''}:${line.requestId ?? ''}`;
  if (key === EMPTY_MESSAGE_KEY) return true;
  if (seenMessageIds.has(key)) return false;
  seenMessageIds.add(key);
  return true;
}

/**
 * Count the token usage of an assistant line into the day, model and session aggregates.
 * Returns the token total that was counted, or null when the line carries none (or was a duplicate).
 */
export function recordUsage(line: any, tsMs: number, context: UsageContext): number | null {
  const usage = line.message?.usage;
  if (!usage || line.type !== 'assistant' || Number.isNaN(tsMs)) return null;
  if (!isFirstSighting(line)) return null;
  const model: string = line.message.model ?? 'unknown';
  if (model === SYNTHETIC_MODEL) return null;

  const tokens: TokenCounts = {
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite: usage.cache_creation_input_tokens ?? 0,
  };
  const total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;

  const day = dayAggFor(localDay(tsMs));
  addTokens(day.tokens, tokens);
  day.byProject[context.project] = (day.byProject[context.project] ?? 0) + total;
  day.byModel[model] = (day.byModel[model] ?? 0) + total;
  modelTotals[model] = (modelTotals[model] ?? 0) + total;

  const session = sessionAggFor(context);
  addTokens(session.tokens, tokens);
  if (!context.isSubagentFile) {
    session.cwd = context.cwd || session.cwd;
    session.branch = context.branch ?? session.branch;
    session.project = context.project;
  }
  if (tsMs > session.lastTsMs) session.lastTsMs = tsMs;
  return total;
}

/** Note a rate-limit rejection of a line, if it is one. */
export function recordLimitHit(line: any, tsMs: number, project: string): void {
  const quota = line.quotaLimits;
  if (!quota || quota.status !== 'rejected' || Number.isNaN(tsMs)) return;
  limitHits.push({
    tsMs,
    type: String(quota.rateLimitType ?? 'unknown'),
    resetsAtMs: quota.resetsAt ? Number(quota.resetsAt) * MS_PER_SECOND : null,
    project,
  });
}

/** Keep the newest main transcript per session. */
export function indexTranscript(sessionId: string, location: TranscriptLocation): void {
  const previous = transcriptIndex.get(sessionId);
  if (!previous || location.lastTsMs >= previous.lastTsMs) transcriptIndex.set(sessionId, location);
}

function recordIncomingPeerMessage(line: any, tsMs: number, sessionId: string): void {
  const peer = peerOrigin(line);
  if (!peer) return;
  const body = String(peer.body ?? contentText(line.message?.content));
  const isSubagent = body.startsWith('[Subagent hand-back]') || Boolean(peer.senderTaskId);
  messages.push({
    tsMs,
    kind: isSubagent ? 'subagent' : 'session',
    direction: 'in',
    sessionId,
    sessionName: '',
    peer: peerName(peer),
    snippet: snippet(handbackBody(body), SNIPPET_MAX_CHARS),
  });
}

function recordOutgoingMessages(line: any, tsMs: number, sessionId: string): void {
  if (line.type !== 'assistant' || !Array.isArray(line.message?.content)) return;
  for (const part of line.message.content) {
    if (part?.type !== 'tool_use' || part.name !== 'SendMessage') continue;
    const body = part.input?.message;
    messages.push({
      tsMs,
      kind: 'session',
      direction: 'out',
      sessionId,
      sessionName: '',
      // `to` may carry a ListAgents ref to pick between sessions of the same name: "worker [3fa9c1]".
      peer: String(part.input?.to || 'unknown').replace(/ \[[0-9A-Za-z]+\]$/, ''),
      snippet: snippet(typeof body === 'string' ? body : JSON.stringify(body ?? ''), SNIPPET_MAX_CHARS),
    });
  }
}

/** Collect the peer messages a main-transcript line received or sent. */
export function recordMessages(line: any, tsMs: number, sessionId: string): void {
  recordIncomingPeerMessage(line, tsMs, sessionId);
  recordOutgoingMessages(line, tsMs, sessionId);
}
