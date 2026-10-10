// Pure launch-form and launch-list logic (no DOM): testable with node --test.
import type { AuditEntry } from '../../../shared/types/index.ts';
import { timeLabel } from '../audit/audit.logic.ts';

/** Longest goal text shown in the launch list. */
export const GOAL_SHOWN_MAX = 120;

/** The POST /api/commands body. */
export interface LaunchBody {
  project: string;
  goal: string;
  notes: string;
  permissionMode: string;
}

/** The POST /api/commands body: goal and notes trimmed. The server validates (empty goal, unknown project). */
export function launchBody(project: string, goal: string, notes: string, permissionMode: string): LaunchBody {
  return { project, goal: goal.trim(), notes: notes.trim(), permissionMode };
}

/** Typed goal and notes are cleared after a successful start and kept after a failed one. */
export const fieldsAfterLaunch = (ok: boolean): { clearGoal: boolean; clearNotes: boolean } => ({ clearGoal: ok, clearNotes: ok });

/** Shortened text with an ellipsis; whitespace runs collapse to one space. */
export function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, Math.max(0, max - 1)).trimEnd()}…` : flat;
}

/** Launch status shown in the list. */
export type LaunchState = 'running' | 'not live' | 'failed';

/** One row of the launch list. */
export interface LaunchRow {
  /** Stable key for the patcher. */
  key: string;
  time: string;
  /** Epoch ms of the launch, null when the timestamp does not parse. */
  tsMs: number | null;
  project: string;
  goal: string;
  device: string;
  /** Short background id; empty when the start failed or had none. */
  session: string;
  ok: boolean;
}

/** Turn one audit entry into a launch-list row. */
export function launchRow(entry: AuditEntry): LaunchRow {
  return {
    key: `${entry.ts}|${entry.session ?? ''}|${entry.project ?? ''}`,
    time: timeLabel(entry.ts),
    tsMs: Number.isNaN(Date.parse(entry.ts)) ? null : Date.parse(entry.ts),
    project: entry.project ?? '',
    goal: truncate(entry.goal ?? entry.prompt ?? '', GOAL_SHOWN_MAX),
    device: entry.device ?? entry.deviceId ?? 'unknown',
    session: entry.ok === false ? '' : (entry.session ?? ''),
    ok: entry.ok !== false,
  };
}

/** Failed launches are never live; a launch with no id cannot be linked, so it counts as not live. */
export function launchState(row: Pick<LaunchRow, 'ok' | 'session'>, isLive: boolean): LaunchState {
  if (!row.ok) return 'failed';
  return row.session && isLive ? 'running' : 'not live';
}
