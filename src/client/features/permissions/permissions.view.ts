import type { AuditEntry, DashboardState } from '../../../shared/types/index.ts';
import { patchHtml } from '../../app/patch.ts';
import { api, ApiError } from '../../shared/api.ts';
import { elementById } from '../../shared/dom.ts';
import { answerErrorMessage, approvalListHtml, canAnswer, pendingRequests, requestItemHtml, sessionLabel } from './permissions.logic.ts';
import type { AnswerProgress } from './permissions.logic.ts';

const progressById = new Map<string, AnswerProgress>();
let redraw: () => void = () => {};
let seq = 0;

/** Where a pending request is listed: the sessions section or the needs-you list. */
export type PermissionContext = 'sessions' | 'alerts';

function dropFinished(pendingIds: ReadonlySet<string>): void {
  for (const id of progressById.keys()) if (!pendingIds.has(id)) progressById.delete(id);
}

/** Markup of the pending requests for one list; empty string when none wait. */
export function permissionItemsHtml(state: DashboardState, context: PermissionContext): string {
  const pending = pendingRequests(state);
  dropFinished(new Set(pending.map((request) => request.id)));
  const isAnswerable = canAnswer(state.features);
  return pending.map((request) => requestItemHtml(request, sessionLabel(request.sessionId, state.sessions), isAnswerable, progressById.get(request.id), context)).join('');
}

/** Number of pending requests, counted in the needs-you total. */
export const pendingCount = (state: DashboardState): number => pendingRequests(state).length;

async function decide(requestId: string, decision: 'allow' | 'deny'): Promise<void> {
  progressById.set(requestId, { isBusy: true, message: '' });
  redraw();
  try {
    await api(`/api/permissions/${encodeURIComponent(requestId)}`, { decision });
    // Stays busy: the request leaves the list when a state push no longer shows it as pending.
  } catch (error) {
    const message = answerErrorMessage(error instanceof ApiError ? error.message : null);
    progressById.set(requestId, { isBusy: false, message });
    redraw();
  }
}

async function loadApprovals(): Promise<void> {
  const refresh = elementById<HTMLButtonElement>('approvals-refresh');
  const status = elementById('approvals-status');
  const mine = ++seq;
  refresh.disabled = true;
  status.textContent = 'Loading...';
  try {
    const { approvals } = await api<{ approvals: AuditEntry[] }>('/api/approvals');
    if (mine !== seq) return;
    patchHtml(elementById('approvals-list'), approvalListHtml(approvals));
    status.textContent = '';
  } catch {
    if (mine === seq) status.textContent = 'Could not load the approvals.';
  } finally {
    if (mine === seq) refresh.disabled = false;
  }
}

/** The Approvals section only exists while commands are allowed. */
export function updateApprovals(state: DashboardState): void {
  elementById('approvals').hidden = !state.features.commands;
}

/** Reload the approval log; called when its popup opens. */
export function renderApprovals(): void {
  void loadApprovals();
}

/** Wire the Approve/Deny buttons (one document listener) and the Refresh button; `redrawLists` repaints the lists. */
export function initPermissions(redrawLists: () => void): void {
  redraw = redrawLists;
  document.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-permission-decide]');
    if (!button || button.disabled) return;
    const requestId = button.dataset['permissionId'];
    const decision = button.dataset['permissionDecide'];
    if (requestId && (decision === 'allow' || decision === 'deny')) void decide(requestId, decision);
  });
  elementById('approvals-refresh').addEventListener('click', () => void loadApprovals());
}
