// Pure session helpers (no DOM): testable with node --test.
import type { SessionInfo } from '../../../shared/types/index.ts';

/** Whether the session was started by a background `claude --bg` run. */
export const isBackgroundSession = (session: Pick<SessionInfo, 'kind'>): boolean => session.kind === 'background' || session.kind === 'bg';

/** CSS state class of the status dot in the session table. */
export function dotStateClass(status: string): string {
  if (status === 'busy') return 'is-busy';
  if (status === 'idle') return 'is-idle';
  return '';
}
