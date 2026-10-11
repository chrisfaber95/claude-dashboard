// Pure permission-prompt logic (no DOM): testable with node --test.
import type { AuditEntry, DashboardState, PermissionRequestInfo, SessionInfo } from '../../../shared/types/index.ts';
import { isRecord } from '../../../shared/guards.ts';
import { timeLabel } from '../audit/audit.logic.ts';

const SHORT_ID_LENGTH = 8;

/** Shown instead of the buttons when this device may not answer (the PC itself). */
export const PC_HINT = 'Answer from a paired phone or tablet, or with `claude attach` here.';
const GENERIC_ERROR = 'Could not send the answer.';

// Only these server strings are mapped to a message; anything else becomes the generic one.
const ERROR_MESSAGES: Record<string, string> = {
  'answering needs a paired device': 'Answering needs a paired device.',
  'unknown permission request': 'This request expired or was already answered.',
  'permission request already answered or expired': 'This request expired or was already answered.',
  'commands are disabled': 'Commands are disabled on this dashboard.',
};

const OUTCOME_LABELS = { allow: 'Allowed', deny: 'Denied', expired: 'Expired' } as const;
type KnownOutcome = keyof typeof OUTCOME_LABELS;

function knownOutcomeOf(outcome: string | undefined): KnownOutcome | null {
  if (outcome === 'allow' || outcome === 'deny' || outcome === 'expired') return outcome;
  return null;
}

/** What a request's buttons currently show: busy while the answer is on its way, a fixed message after a failure. */
export interface AnswerProgress {
  isBusy: boolean;
  message: string;
}

/** Requests that still wait for an answer; expired ones are left out. */
export function pendingRequests(state: Pick<DashboardState, 'permissions'>): PermissionRequestInfo[] {
  return (state.permissions ?? []).filter((request) => request.status === 'pending');
}

/** The PC itself (manageDevices) cannot answer: the server refuses it; so does a dashboard with commands off. */
export function canAnswer(features: Pick<DashboardState['features'], 'commands' | 'manageDevices'>): boolean {
  return features.commands && !features.manageDevices;
}

/** The session's name, else its first 8 id characters. */
export function sessionLabel(sessionId: string, sessions: readonly Pick<SessionInfo, 'sessionId' | 'name'>[]): string {
  const found = sessions.find((session) => session.sessionId === sessionId);
  return found?.name || sessionId.slice(0, SHORT_ID_LENGTH);
}

/** A fixed message for a failed answer; raw server or exception text never reaches the page. */
export function answerErrorMessage(serverMessage: string | null): string {
  return (serverMessage !== null && Object.hasOwn(ERROR_MESSAGES, serverMessage) && ERROR_MESSAGES[serverMessage]) || GENERIC_ERROR;
}

/** One approval-log entry prepared for display. */
export interface ApprovalRow {
  time: string;
  device: string;
  session: string;
  tool: string;
  text: string;
  outcome: string;
  /** Modifier of `approvals__outcome`: the outcome itself, or `unknown`. */
  outcomeClass: string;
}

/** Turn an approval-log entry into display strings; missing fields get a neutral value. */
export function approvalRowOf(entry: AuditEntry): ApprovalRow {
  const outcome = knownOutcomeOf(entry.outcome);
  return {
    time: timeLabel(entry.ts),
    device: entry.device ?? entry.deviceId ?? 'unknown',
    session: entry.session ? entry.session.slice(0, SHORT_ID_LENGTH) : '',
    tool: entry.tool ?? '',
    text: entry.text ?? '',
    outcome: outcome === null ? 'Unknown' : OUTCOME_LABELS[outcome],
    outcomeClass: outcome ?? 'unknown',
  };
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

/** The entries of a `/api/approvals` body, or null when it is not `{ approvals: [...] }`; unusable items are skipped. */
export function approvalEntriesOf(body: unknown): AuditEntry[] | null {
  if (!isRecord(body) || !Array.isArray(body.approvals)) return null;
  const entries: AuditEntry[] = [];
  for (const item of body.approvals) {
    if (!isRecord(item)) continue;
    const { ts, action } = item;
    if (typeof ts !== 'string' || typeof action !== 'string') continue;
    entries.push({
      ts,
      action,
      device: optionalString(item, 'device'),
      deviceId: optionalString(item, 'deviceId'),
      session: optionalString(item, 'session'),
      tool: optionalString(item, 'tool'),
      text: optionalString(item, 'text'),
      outcome: optionalString(item, 'outcome'),
    });
  }
  return entries;
}
