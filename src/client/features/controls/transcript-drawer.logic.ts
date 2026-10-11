import type { TranscriptEntry } from '../../../shared/types/index.ts';

/** The entries after a poll: the live tail replaces its overlap, while earlier pages the reader loaded stay. */
export function mergeLiveTail(current: TranscriptEntry[], tail: TranscriptEntry[]): TranscriptEntry[] {
  const firstTailUuid = tail[0]?.uuid;
  if (!firstTailUuid) return tail;
  const overlapIndex = current.findIndex((entry) => entry.uuid === firstTailUuid);
  return [...current.slice(0, Math.max(0, overlapIndex)), ...tail];
}

/** A session started outside the dashboard (terminal, editor) can't take a follow-up; the server answers 409. */
export function isLiveElsewhere(sessionId: string, sessions: ReadonlyArray<{ sessionId: string; kind: string }>): boolean {
  return sessions.some((session) => session.sessionId === sessionId && session.kind !== 'bg');
}
