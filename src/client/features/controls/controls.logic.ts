// Pure logic of the transcript drawer and the run panel (no DOM): testable with node --test.
import type { CommandResult, TranscriptEntry } from '../../../shared/types/index.ts';

const MIN_SHORT_ID_LENGTH = 4;

/** What the drawer shows: a session's transcript, a subagent's transcript or a background session's terminal logs. */
export type DrawerMode = { kind: 'transcript'; id: string } | { kind: 'subagent'; id: string } | { kind: 'logs'; id: string };

/** Drawer modes that show a transcript (a session's or a subagent's), as opposed to terminal logs. */
export type TranscriptDrawerMode = Extract<DrawerMode, { kind: 'transcript' | 'subagent' }>;

/** Whether the drawer shows a transcript (and so has a transcript endpoint). */
export const showsTranscript = (mode: DrawerMode | null): mode is TranscriptDrawerMode => mode?.kind === 'transcript' || mode?.kind === 'subagent';

/** The transcript API path of a transcript drawer, with its query string. */
export const transcriptPath = (mode: TranscriptDrawerMode, query: string): string =>
  `/api/${mode.kind === 'subagent' ? 'subagents' : 'sessions'}/${encodeURIComponent(mode.id)}/transcript?${query}`;

const ROLE_LABEL: Record<TranscriptEntry['role'], string> = {
  user: 'You',
  assistant: 'Claude',
  tool: 'Tool call',
  result: 'Tool result',
  peer: 'Message',
};

// A subagent's transcript starts with the brief its caller handed down and ends with its report.
const SUBAGENT_LABEL: Partial<Record<TranscriptEntry['role'], string>> = { user: 'Brief from caller', assistant: 'Subagent' };

/** Who spoke in a transcript entry, as shown in its header. */
export function entrySpeaker(entry: TranscriptEntry, isSubagentDrawer: boolean): string {
  if (entry.role === 'peer' && entry.from) return `Message from ${entry.from}`;
  return (isSubagentDrawer && SUBAGENT_LABEL[entry.role]) || ROLE_LABEL[entry.role];
}

/** One-line outcome text of a start or follow-up command. */
export function describeCommandResult(result: CommandResult): string {
  if (result.needsTrust) return `Folder not trusted yet. ${result.needsTrust}`;
  return result.ok ? `Started${result.id ? ` (${result.id})` : ''}. ${result.output}`.trim() : result.output || 'Command failed.';
}

/** Exact id first, then a prefix match only when it is unambiguous. */
export function matchSession<T extends { sessionId: string }>(sessions: T[], id: string): T | undefined {
  if (id.length < MIN_SHORT_ID_LENGTH) return undefined;
  const exact = sessions.find((session) => session.sessionId === id);
  if (exact) return exact;
  const prefixed = sessions.filter((session) => session.sessionId.startsWith(id));
  return prefixed.length === 1 ? prefixed[0] : undefined;
}

/** A session found for a short background id. */
export interface ResolvedSession {
  id: string;
  name: string;
  isLive: boolean;
}

/** Full session id for a short background id, from the live and recent sessions; null when not known yet. */
export function resolveSession(
  shortId: string,
  sessions: { sessionId: string; name: string }[],
  recentSessions: { sessionId: string; live: boolean }[],
): ResolvedSession | null {
  if (shortId.length < MIN_SHORT_ID_LENGTH) return null;
  const live = matchSession(sessions, shortId);
  if (live) return { id: live.sessionId, name: live.name || live.sessionId, isLive: true };
  const old = matchSession(recentSessions, shortId);
  return old ? { id: old.sessionId, name: old.sessionId, isLive: old.live } : null;
}
