// Pure permission-prompt logic (no DOM): testable with node --test.
import type { AuditEntry, DashboardState, PermissionRequestInfo, SessionInfo } from '../../../shared/types/index.ts';
import { esc } from '../../shared/escape.ts';
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

const OUTCOME_LABELS: Record<string, string> = { allow: 'Allowed', deny: 'Denied', expired: 'Expired' };
const KNOWN_OUTCOMES = new Set(['allow', 'deny', 'expired']);

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
}

/** Turn an approval-log entry into display strings; missing fields get a neutral value. */
export function approvalRowOf(entry: AuditEntry): ApprovalRow {
  const isKnownOutcome = entry.outcome !== undefined && KNOWN_OUTCOMES.has(entry.outcome);
  return {
    time: timeLabel(entry.ts),
    device: entry.device ?? entry.deviceId ?? 'unknown',
    session: entry.session ? entry.session.slice(0, SHORT_ID_LENGTH) : '',
    tool: entry.tool ?? '',
    text: entry.text ?? '',
    outcome: isKnownOutcome ? OUTCOME_LABELS[entry.outcome!]! : 'Unknown',
  };
}

/** One approval-log list item. */
export function approvalHtml(entry: AuditEntry): string {
  const row = approvalRowOf(entry);
  const outcomeClass = entry.outcome !== undefined && KNOWN_OUTCOMES.has(entry.outcome) ? entry.outcome : 'unknown';
  const session = row.session ? ` <span class="approvals__session">${esc(row.session)}</span>` : '';
  const tool = row.tool ? ` <strong class="approvals__tool">${esc(row.tool)}</strong>` : '';
  const text = row.text ? `<div class="permission__text">${esc(row.text)}</div>` : '';
  return `<li class="approvals__item"><div class="approvals__line"><span class="approvals__time sub">${esc(row.time)}</span> <span class="approvals__device">${esc(row.device)}</span>${session}${tool} <span class="approvals__outcome approvals__outcome--${outcomeClass}">${esc(row.outcome)}</span></div>${text}</li>`;
}

/** The whole approval list, or the empty state. */
export function approvalListHtml(entries: readonly AuditEntry[]): string {
  return entries.length ? entries.map(approvalHtml).join('') : '<li class="empty">No approvals yet.</li>';
}

function buttonsHtml(requestId: string, isBusy: boolean): string {
  const disabled = isBusy ? ' disabled' : '';
  const id = esc(requestId);
  return `<button class="btn btn--sm" type="button" data-permission-decide="allow" data-permission-id="${id}"${disabled}>Approve</button>
    <button class="btn btn--sm" type="button" data-permission-decide="deny" data-permission-id="${id}"${disabled}>Deny</button>`;
}

/** One pending request as a keyed list item; `context` keeps the key unique when it is shown in two lists. */
export function requestItemHtml(request: PermissionRequestInfo, label: string, isAnswerable: boolean, progress: AnswerProgress | undefined, context: string): string {
  const controls = isAnswerable ? buttonsHtml(request.id, progress?.isBusy === true) : `<span class="sub permission__hint">${esc(PC_HINT)}</span>`;
  return `<li class="permission" data-key="${esc(`permission-${context}-${request.id}`)}">
    <div class="permission__head"><strong class="permission__tool">${esc(request.tool)}</strong> <span class="sub">${esc(label)}</span></div>
    <div class="permission__text">${esc(request.text)}</div>
    <div class="permission__actions">${controls} <span class="sub permission__status" role="status">${esc(progress?.message ?? '')}</span></div></li>`;
}
