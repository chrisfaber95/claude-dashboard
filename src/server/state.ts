import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CLAUDE_DIR, CLAUDE_JSON, COMMANDS_ENABLED, LAN_MODE, PROJECTS_ROOT, emptyTokens, localDay, normPath } from './config.ts';
import { buildAlerts } from './alerts.ts';
import { getLimits } from './limits.ts';
import { readTeamBoard } from './team.ts';
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
import { PERMISSION_MODES, type DashboardState, type ProjectInfo, type SessionInfo } from '../shared/types.ts';

/** Folders the Claude CLI trusts, from ~/.claude.json (keys look like "n:/Projects/ShopApp"). */
function trustedPaths(): Set<string> {
  try {
    const j = JSON.parse(readFileSync(CLAUDE_JSON, 'utf8'));
    return new Set(
      Object.entries(j.projects ?? {})
        .filter(([, v]) => (v as { hasTrustDialogAccepted?: boolean })?.hasTrustDialogAccepted)
        .map(([k]) => normPath(k)),
    );
  } catch {
    return new Set();
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function readSessions(): SessionInfo[] {
  const dir = join(CLAUDE_DIR, 'sessions');
  const out: SessionInfo[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return out;
  }
  for (const n of names) {
    try {
      const s = JSON.parse(readFileSync(join(dir, n), 'utf8'));
      if (!s.pid || !pidAlive(s.pid)) continue;
      const agg = sessionAgg.get(s.sessionId);
      out.push({
        sessionId: s.sessionId,
        pid: s.pid,
        name: s.name ?? String(s.sessionId).slice(0, 8),
        project: projectOf(s.cwd ?? ''),
        cwd: s.cwd ?? '',
        status: s.status ?? 'unknown',
        entrypoint: s.entrypoint ?? '',
        kind: s.kind ?? 'interactive',
        startedAtMs: s.startedAt ?? 0,
        updatedAtMs: s.updatedAt ?? s.startedAt ?? 0,
        branch: agg?.branch ?? null,
        tokens: agg?.tokens ?? emptyTokens(),
      });
    } catch {
      // partial write; skip this tick
    }
  }
  return out.sort((a, b) => a.startedAtMs - b.startedAtMs);
}

function gitBranch(dir: string): { branch: string | null; worktree: boolean } {
  try {
    const g = join(dir, '.git');
    if (!existsSync(g)) return { branch: null, worktree: false };
    const isFile = statSync(g).isFile();
    let headPath = join(g, 'HEAD');
    if (isFile) {
      const ptr = readFileSync(g, 'utf8').match(/gitdir:\s*(.+)/)?.[1]?.trim();
      if (!ptr) return { branch: null, worktree: true };
      headPath = join(ptr, 'HEAD');
    }
    const head = readFileSync(headPath, 'utf8').trim();
    const m = head.match(/^ref: refs\/heads\/(.+)$/);
    return { branch: m ? m[1] : head.slice(0, 8), worktree: isFile };
  } catch {
    return { branch: null, worktree: false };
  }
}

export function buildState(features: { lan?: boolean; commands?: boolean; manageDevices?: boolean } = {}): DashboardState {
  scanTranscripts();
  const sessions = readSessions();
  const now = Date.now();
  const today = localDay(now);
  const weekAgo = localDay(now - 6 * 86_400_000);

  const nameById = new Map(sessions.map((s) => [s.sessionId, s.name]));
  const msgs = messages
    .filter((m) => m.kind === 'session' || m.direction === 'in')
    .slice(-200)
    .map((m) => ({ ...m, sessionName: nameById.get(m.sessionId) ?? m.sessionId.slice(0, 8) }))
    .reverse();

  const liveIds = new Set(sessions.map((x) => x.sessionId));
  const recentSessions = [...transcriptIndex.entries()]
    .map(([sessionId, t]) => ({ sessionId, project: t.project, lastTsMs: t.lastTsMs, live: liveIds.has(sessionId) }))
    .sort((a, b) => b.lastTsMs - a.lastTsMs)
    .slice(0, 30);

  const trusted = trustedPaths();
  const projects: ProjectInfo[] = [];
  let dirs: string[] = [];
  try {
    dirs = readdirSync(PROJECTS_ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name);
  } catch {
    // projects root unavailable
  }
  for (const name of dirs) {
    const path = join(PROJECTS_ROOT, name);
    const git = gitBranch(path);
    let today_ = 0;
    let week = 0;
    let total = 0;
    for (const [day, d] of dayAgg) {
      const v = d.byProject[name] ?? 0;
      total += v;
      if (day >= weekAgo) week += v;
      if (day === today) today_ += v;
    }
    let last = projectLastActive.get(name) ?? null;
    if (last === null) {
      try {
        last = statSync(path).mtimeMs;
      } catch {
        last = null;
      }
    }
    projects.push({
      name,
      path,
      branch: git.branch,
      isWorktree: git.worktree || /-wt$/i.test(name),
      lastActiveMs: last,
      trusted: trusted.has(normPath(path)),
      liveSessions: sessions.filter((s) => normPath(s.project) === normPath(name)).length,
      tokensToday: today_,
      tokens7d: week,
      tokensTotal: total,
    });
  }
  projects.sort((a, b) => (b.liveSessions - a.liveSessions) || ((b.lastActiveMs ?? 0) - (a.lastActiveMs ?? 0)));

  const totals = emptyTokens();
  const days = [...dayAgg.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, d]) => {
      totals.input += d.tokens.input;
      totals.output += d.tokens.output;
      totals.cacheRead += d.tokens.cacheRead;
      totals.cacheWrite += d.tokens.cacheWrite;
      return { day, byProject: d.byProject, byModel: d.byModel, tokens: d.tokens };
    });

  const limits = getLimits();
  const team = readTeamBoard();
  return {
    generatedAtMs: now,
    projects,
    sessions,
    subagents: buildSubagents(liveIds, now),
    messages: msgs,
    usage: { days, totals, byModel: { ...modelTotals } },
    limits,
    recentSessions,
    features: { lan: features.lan ?? LAN_MODE, commands: features.commands ?? COMMANDS_ENABLED, permissionModes: PERMISSION_MODES, manageDevices: features.manageDevices ?? false },
    team,
    alerts: buildAlerts({ sessions, limits, team, nowMs: now }),
    permissions: [],
  };
}
