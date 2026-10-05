export interface TokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

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

export interface UsageDay {
  day: string; // YYYY-MM-DD (local)
  byProject: Record<string, number>;
  byModel: Record<string, number>;
  tokens: TokenCounts;
}

export interface LimitWindow {
  key: string;
  label: string;
  utilization: number; // percent 0..100
  resetsAtMs: number | null;
}

export interface LimitHit {
  tsMs: number;
  type: string;
  resetsAtMs: number | null;
  project: string;
}

export interface LimitsInfo {
  source: 'live' | 'cache' | 'none';
  fetchedAtMs: number | null;
  error: string | null;
  windows: LimitWindow[];
  hits: LimitHit[];
}

export interface TranscriptEntry {
  uuid: string;
  tsMs: number;
  role: 'user' | 'assistant' | 'tool' | 'result' | 'peer';
  text: string;
  from?: string;
  isError?: boolean;
}

export interface TranscriptPage {
  entries: TranscriptEntry[];
  hasMore: boolean;
  /** Older history exists but is beyond the viewer's size cap. */
  truncated?: boolean;
}

export interface RecentSession {
  sessionId: string;
  project: string;
  lastTsMs: number;
  live: boolean;
}

export const PERMISSION_MODES = ['plan', 'default', 'acceptEdits', 'auto'] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export interface CommandResult {
  ok: boolean;
  output: string;
  /** Background session id when the CLI printed one. */
  id?: string;
  /** Set when the CLI refused because the folder isn't trusted yet. */
  needsTrust?: string;
}

export interface DashboardState {
  generatedAtMs: number;
  projects: ProjectInfo[];
  sessions: SessionInfo[];
  messages: MessageInfo[];
  usage: { days: UsageDay[]; totals: TokenCounts; byModel: Record<string, number> };
  limits: LimitsInfo;
  recentSessions: RecentSession[];
  features: { lan: boolean; commands: boolean; permissionModes: readonly PermissionMode[] };
}
