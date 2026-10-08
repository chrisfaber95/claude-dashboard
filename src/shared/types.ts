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

export const TEAM_COLUMNS = ['backlog', 'ready', 'in-progress', 'review', 'done', 'blocked'] as const;
export type TeamColumn = (typeof TEAM_COLUMNS)[number];

export interface TeamTicket {
  id: string;
  title: string;
}

/** Read-only summary of the team-hq board. */
export interface TeamBoard {
  counts: Record<TeamColumn, number>;
  active: { inProgress: TeamTicket[]; review: TeamTicket[]; blocked: TeamTicket[] };
  needsYou: string[];
}

export interface DashboardState {
  generatedAtMs: number;
  projects: ProjectInfo[];
  sessions: SessionInfo[];
  /** Subagents of live sessions that are working or finished recently. */
  subagents: SubagentInfo[];
  messages: MessageInfo[];
  usage: { days: UsageDay[]; totals: TokenCounts; byModel: Record<string, number> };
  limits: LimitsInfo;
  recentSessions: RecentSession[];
  features: { lan: boolean; commands: boolean; permissionModes: readonly PermissionMode[] };
  /** Team board summary; null = no board found (hidden). */
  team: TeamBoard | null;
}
