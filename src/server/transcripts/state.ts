import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CLAUDE_DIR, CLAUDE_JSON, canRunCommands, isLanMode, PROJECTS_ROOT, emptyTokens, localDay, normPath } from '../config.ts';
import { buildAlerts } from '../features/alerts/alerts.ts';
import { getLimits } from '../features/limits/limits.ts';
import { readTeamBoard } from '../features/team/team.ts';
import {
  buildSubagents,
  dayAgg,
  messages,
  modelTotals,
  projectLastActive,
  projectOf,
  scanTranscripts,
  sessionAgg,
  transcriptIndex,
} from './transcripts.ts';
import {
  PERMISSION_MODES,
  type DashboardState,
  type MessageInfo,
  type ProjectInfo,
  type SessionInfo,
} from '../../shared/types/index.ts';

const DAY_MS = 86_400_000;
/** The "7 days" window is today plus the six days before it. */
const WEEK_LOOKBACK_DAYS = 6;
const MESSAGES_MAX = 200;
const RECENT_SESSIONS_MAX = 30;
const SHORT_SESSION_ID_LENGTH = 8;
const SHORT_BRANCH_LENGTH = 8;

interface BuildStateFeatures {
  lan?: boolean;
  commands?: boolean;
  manageDevices?: boolean;
}

/** Folders the Claude CLI trusts, from ~/.claude.json (keys look like "n:/Projects/ShopApp"). */
function trustedPaths(): Set<string> {
  try {
    const claudeJson = JSON.parse(readFileSync(CLAUDE_JSON, 'utf8'));
    return new Set(
      Object.entries(claudeJson.projects ?? {})
        .filter(([, project]) => (project as { hasTrustDialogAccepted?: boolean })?.hasTrustDialogAccepted)
        .map(([path]) => normPath(path)),
    );
  } catch {
    return new Set();
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The live Claude Code sessions: one JSON file per session under ~/.claude/sessions, with a running pid. */
export function readSessions(): SessionInfo[] {
  const dir = join(CLAUDE_DIR, 'sessions');
  const out: SessionInfo[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.json'));
  } catch {
    return out;
  }
  for (const name of names) {
    try {
      const session = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      if (!session.pid || !isPidAlive(session.pid)) continue;
      const aggregate = sessionAgg.get(session.sessionId);
      out.push({
        sessionId: session.sessionId,
        pid: session.pid,
        name: session.name ?? String(session.sessionId).slice(0, SHORT_SESSION_ID_LENGTH),
        project: projectOf(session.cwd ?? ''),
        cwd: session.cwd ?? '',
        status: session.status ?? 'unknown',
        entrypoint: session.entrypoint ?? '',
        kind: session.kind ?? 'interactive',
        startedAtMs: session.startedAt ?? 0,
        updatedAtMs: session.updatedAt ?? session.startedAt ?? 0,
        branch: aggregate?.branch ?? null,
        tokens: aggregate?.tokens ?? emptyTokens(),
      });
    } catch {
      // partial write; skip this tick
    }
  }
  return out.sort((a, b) => a.startedAtMs - b.startedAtMs);
}

function gitBranch(dir: string): { branch: string | null; isWorktree: boolean } {
  try {
    const gitPath = join(dir, '.git');
    if (!existsSync(gitPath)) return { branch: null, isWorktree: false };
    const isFile = statSync(gitPath).isFile();
    let headPath = join(gitPath, 'HEAD');
    if (isFile) {
      const gitDir = readFileSync(gitPath, 'utf8').match(/gitdir:\s*(.+)/)?.[1]?.trim();
      if (!gitDir) return { branch: null, isWorktree: true };
      headPath = join(gitDir, 'HEAD');
    }
    const head = readFileSync(headPath, 'utf8').trim();
    const branchMatch = head.match(/^ref: refs\/heads\/(.+)$/);
    return { branch: branchMatch ? branchMatch[1] : head.slice(0, SHORT_BRANCH_LENGTH), isWorktree: isFile };
  } catch {
    return { branch: null, isWorktree: false };
  }
}

/** Tokens of one project: today, the last seven days and all time. */
function projectTokens(name: string, today: string, weekAgo: string) {
  let tokensToday = 0;
  let tokens7d = 0;
  let tokensTotal = 0;
  for (const [day, aggregate] of dayAgg) {
    const tokens = aggregate.byProject[name] ?? 0;
    tokensTotal += tokens;
    if (day >= weekAgo) tokens7d += tokens;
    if (day === today) tokensToday += tokens;
  }
  return { tokensToday, tokens7d, tokensTotal };
}

function lastActiveOf(name: string, path: string): number | null {
  const known = projectLastActive.get(name);
  if (known !== undefined) return known;
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

function projectFolderNames(): string[] {
  try {
    return readdirSync(PROJECTS_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name);
  } catch {
    return []; // projects root unavailable
  }
}

function buildProjects(sessions: SessionInfo[], today: string, weekAgo: string): ProjectInfo[] {
  const trusted = trustedPaths();
  const projects = projectFolderNames().map((name): ProjectInfo => {
    const path = join(PROJECTS_ROOT, name);
    const git = gitBranch(path);
    return {
      name,
      path,
      branch: git.branch,
      isWorktree: git.isWorktree || /-wt$/i.test(name),
      lastActiveMs: lastActiveOf(name, path),
      trusted: trusted.has(normPath(path)),
      liveSessions: sessions.filter((session) => normPath(session.project) === normPath(name)).length,
      ...projectTokens(name, today, weekAgo),
    };
  });
  return projects.sort((a, b) => (b.liveSessions - a.liveSessions) || ((b.lastActiveMs ?? 0) - (a.lastActiveMs ?? 0)));
}

function buildMessages(sessions: SessionInfo[]): MessageInfo[] {
  const nameById = new Map(sessions.map((session) => [session.sessionId, session.name]));
  return messages
    .filter((message) => message.kind === 'session' || message.direction === 'in')
    .slice(-MESSAGES_MAX)
    .map((message) => ({ ...message, sessionName: nameById.get(message.sessionId) ?? message.sessionId.slice(0, SHORT_SESSION_ID_LENGTH) }))
    .reverse();
}

function buildRecentSessions(liveIds: Set<string>) {
  return [...transcriptIndex.entries()]
    .map(([sessionId, location]) => ({ sessionId, project: location.project, lastTsMs: location.lastTsMs, live: liveIds.has(sessionId) }))
    .sort((a, b) => b.lastTsMs - a.lastTsMs)
    .slice(0, RECENT_SESSIONS_MAX);
}

function buildUsage() {
  const totals = emptyTokens();
  const days = [...dayAgg.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, aggregate]) => {
      totals.input += aggregate.tokens.input;
      totals.output += aggregate.tokens.output;
      totals.cacheRead += aggregate.tokens.cacheRead;
      totals.cacheWrite += aggregate.tokens.cacheWrite;
      return { day, byProject: aggregate.byProject, byModel: aggregate.byModel, tokens: aggregate.tokens };
    });
  return { days, totals, byModel: { ...modelTotals } };
}

/** Scan the transcripts and assemble the full dashboard state that is pushed to the browser. */
export function buildState(features: BuildStateFeatures = {}): DashboardState {
  scanTranscripts();
  const sessions = readSessions();
  const now = Date.now();
  const liveIds = new Set(sessions.map((session) => session.sessionId));
  const limits = getLimits();
  const team = readTeamBoard();
  return {
    generatedAtMs: now,
    projects: buildProjects(sessions, localDay(now), localDay(now - WEEK_LOOKBACK_DAYS * DAY_MS)),
    sessions,
    subagents: buildSubagents(liveIds, now),
    messages: buildMessages(sessions),
    usage: buildUsage(),
    limits,
    recentSessions: buildRecentSessions(liveIds),
    features: {
      lan: features.lan ?? isLanMode,
      commands: features.commands ?? canRunCommands,
      permissionModes: PERMISSION_MODES,
      manageDevices: features.manageDevices ?? false,
    },
    team,
    alerts: buildAlerts({ sessions, limits, team, nowMs: now }),
    permissions: [],
  };
}
