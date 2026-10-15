// Feed helpers of the session-messages popup (no DOM): testable with node --test.
import type { MessageInfo } from '../../../shared/types/index.ts';

/** Stable key of one feed entry. */
export function feedKey(message: MessageInfo): string {
  return `${message.tsMs}|${message.kind}|${message.direction}|${message.sessionId}|${message.peer}`;
}

/** "sender → receiver" of one message, from the viewpoint of the session that logged it. */
export function routeText(message: MessageInfo): string {
  return message.direction === 'out' ? `${message.sessionName} → ${message.peer}` : `${message.peer} → ${message.sessionName}`;
}
