// Pure status logic (no DOM): shared by the building popup and the Co-pilot core, and testable with node --test.
import type { DashboardState, SessionInfo } from '../../../shared/types/index.ts';

/** Mood of one session as the building popup shows it. */
export type SessionMood = 'busy' | 'waiting' | 'idle';

/** Map a session status to its mood; anything unknown is idle. */
export function moodOf(session: Pick<SessionInfo, 'status'>): SessionMood {
  if (session.status === 'busy') return 'busy';
  if (session.status === 'waiting') return 'waiting';
  return 'idle';
}

/** Overall mood of the core strip. */
export type CoreMood = 'standby' | 'working' | 'waiting';

/** Counts and mood that drive the core strip. */
export interface CoreSummary {
  mood: CoreMood;
  busy: number;
  waiting: number;
  subagentsWorking: number;
  /** Name of the first live session that is waiting, if any. */
  waitingName: string | null;
}

/** Pill text per core mood. */
export const CORE_LABEL: Record<CoreMood, string> = { standby: 'Standby', working: 'Working', waiting: 'Needs you' };

function pickCoreMood(waiting: number, busy: number, subagentsWorking: number): CoreMood {
  if (waiting > 0) return 'waiting';
  if (busy > 0 || subagentsWorking > 0) return 'working';
  return 'standby';
}

/** Count busy and waiting sessions and working subagents, and derive the core mood. */
export function coreSummary(state: Pick<DashboardState, 'sessions' | 'subagents'>): CoreSummary {
  const sessions = state.sessions ?? [];
  const subagents = state.subagents ?? []; // older servers do not send subagents
  let busy = 0;
  let waiting = 0;
  let waitingName: string | null = null;
  for (const session of sessions) {
    const mood = moodOf(session);
    if (mood === 'busy') busy++;
    else if (mood === 'waiting') {
      waiting++;
      waitingName ??= session.name;
    }
  }
  const subagentsWorking = subagents.filter((subagent) => subagent.state === 'working').length;
  const mood = pickCoreMood(waiting, busy, subagentsWorking);
  return { mood, busy, waiting, subagentsWorking, waitingName };
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** Headline split into a lead and an accent clause. */
export interface HeadlineParts {
  /** Main text; may end in a separator. */
  lead: string;
  /** Last clause, shown in the accent colour by the Root skin; can be empty. */
  accent: string;
}

/** Build the core headline as lead plus accent text. */
export function coreHeadlineParts(summary: CoreSummary): HeadlineParts {
  if (summary.mood === 'standby') return { lead: 'All quiet. ', accent: 'Nothing running.' };
  if (summary.mood === 'waiting') {
    const head = `${summary.waitingName ?? 'A session'} is waiting for you`;
    return summary.busy > 0 ? { lead: `${head} · `, accent: `${summary.busy} more working` } : { lead: head, accent: '' };
  }
  if (summary.busy > 0 && summary.subagentsWorking > 0) {
    return { lead: `${plural(summary.busy, 'session', 'sessions')} working · `, accent: plural(summary.subagentsWorking, 'subagent', 'subagents') };
  }
  if (summary.busy > 0) return { lead: `${plural(summary.busy, 'session', 'sessions')} working`, accent: '' };
  if (summary.subagentsWorking > 0) return { lead: `${plural(summary.subagentsWorking, 'subagent', 'subagents')} working`, accent: '' };
  return { lead: '', accent: '' };
}

/** The core headline as one plain string. */
export function coreHeadline(summary: CoreSummary): string {
  const parts = coreHeadlineParts(summary);
  return parts.lead + parts.accent;
}
