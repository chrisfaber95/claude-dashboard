// Pure status logic (no DOM): shared by the building popup and the Co-pilot core, and testable with node --test.
import type { DashboardState, SessionInfo } from '../shared/types/index.ts';

export type SessionMood = 'busy' | 'waiting' | 'idle';

export const moodOf = (s: Pick<SessionInfo, 'status'>): SessionMood =>
  s.status === 'busy' ? 'busy' : s.status === 'waiting' ? 'waiting' : 'idle';

export type CoreMood = 'standby' | 'working' | 'waiting';

export interface CoreSummary {
  mood: CoreMood;
  busy: number;
  waiting: number;
  subagentsWorking: number;
  /** Name of the first live session that is waiting, if any. */
  waitingName: string | null;
}

export const CORE_LABEL: Record<CoreMood, string> = { standby: 'Standby', working: 'Working', waiting: 'Needs you' };

export function coreSummary(s: Pick<DashboardState, 'sessions' | 'subagents'>): CoreSummary {
  const sessions = s.sessions ?? [];
  const subagents = s.subagents ?? []; // older servers do not send subagents
  let busy = 0;
  let waiting = 0;
  let waitingName: string | null = null;
  for (const x of sessions) {
    const m = moodOf(x);
    if (m === 'busy') busy++;
    else if (m === 'waiting') {
      waiting++;
      waitingName ??= x.name;
    }
  }
  const subagentsWorking = subagents.filter((a) => a.state === 'working').length;
  const mood: CoreMood = waiting > 0 ? 'waiting' : busy > 0 || subagentsWorking > 0 ? 'working' : 'standby';
  return { mood, busy, waiting, subagentsWorking, waitingName };
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export interface HeadlineParts {
  /** Main text; may end in a separator. */
  lead: string;
  /** Last clause, shown in the accent colour by the Root skin; can be empty. */
  accent: string;
}

export function coreHeadlineParts(c: CoreSummary): HeadlineParts {
  if (c.mood === 'standby') return { lead: 'All quiet. ', accent: 'Nothing running.' };
  if (c.mood === 'waiting') {
    const head = `${c.waitingName ?? 'A session'} is waiting for you`;
    return c.busy > 0 ? { lead: `${head} · `, accent: `${c.busy} more working` } : { lead: head, accent: '' };
  }
  if (c.busy > 0 && c.subagentsWorking > 0) {
    return { lead: `${plural(c.busy, 'session', 'sessions')} working · `, accent: plural(c.subagentsWorking, 'subagent', 'subagents') };
  }
  if (c.busy > 0) return { lead: `${plural(c.busy, 'session', 'sessions')} working`, accent: '' };
  if (c.subagentsWorking > 0) return { lead: `${plural(c.subagentsWorking, 'subagent', 'subagents')} working`, accent: '' };
  return { lead: '', accent: '' };
}

export function coreHeadline(c: CoreSummary): string {
  const p = coreHeadlineParts(c);
  return p.lead + p.accent;
}
