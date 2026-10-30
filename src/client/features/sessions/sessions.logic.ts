// Pure session helpers (no DOM): testable with node --test.
import type { SessionInfo } from '../../../shared/types/index.ts';

/**
 * Whether the session runs without a terminal: a background `claude --bg` run, or a headless `claude -p` / SDK run
 * (those report `kind: 'interactive'` but an `sdk-*` entrypoint, e.g. `sdk-cli`).
 */
export const isBackgroundSession = (session: Pick<SessionInfo, 'kind' | 'entrypoint'>): boolean =>
  session.kind === 'background' || session.kind === 'bg' || session.entrypoint.startsWith('sdk-');

/** CSS state class of the status dot in the session table. */
export function dotStateClass(status: string): string {
  if (status === 'busy') return 'is-busy';
  if (status === 'idle') return 'is-idle';
  return '';
}
