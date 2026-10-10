import type { TokenCounts } from './usage.ts';

export interface ProjectInfo {
  name: string;
  path: string;
  branch: string | null;
  isWorktree: boolean;
  lastActiveMs: number | null;
  liveSessions: number;
  /** Whether the Claude CLI trusts this folder (required for background tasks). */
  trusted: boolean;
  tokensToday: number;
  tokens7d: number;
  tokensTotal: number;
}

export interface SessionInfo {
  sessionId: string;
  pid: number;
  name: string;
  project: string;
  cwd: string;
  status: string;
  entrypoint: string;
  kind: string;
  startedAtMs: number;
  updatedAtMs: number;
  branch: string | null;
  tokens: TokenCounts;
}

export interface MessageInfo {
  tsMs: number;
  /** 'session' = another Claude session, 'subagent' = hand-back from a delegated agent. */
  kind: 'session' | 'subagent';
  direction: 'in' | 'out';
  /** The session this transcript belongs to. */
  sessionId: string;
  sessionName: string;
  /** The other party (name or id). */
  peer: string;
  snippet: string;
}

/** A subagent a session (or another subagent) handed work to. */
export interface SubagentInfo {
  agentId: string;
  /** The main session this subagent belongs to, also when another subagent spawned it. */
  sessionId: string;
  project: string;
  agentType: string;
  description: string;
  /** The brief that was handed down (clipped). */
  prompt: string;
  background: boolean;
  /** Subagent that spawned this one; null when the main session did. */
  parentAgentId: string | null;
  startedAtMs: number;
  lastTsMs: number;
  /** 'done' also covers a subagent that went quiet without handing anything back. */
  state: 'working' | 'done';
  /** True once it handed a report (or at least a completion notice) back; false for one that just went quiet. */
  handedBack: boolean;
  /** Its latest tool call, e.g. "Read: src/server/auth.ts". Empty once done. */
  activity: string;
  /** What it handed back (clipped); empty until then. */
  result: string;
  tokens: number;
}

export interface RecentSession {
  sessionId: string;
  project: string;
  lastTsMs: number;
  live: boolean;
}
