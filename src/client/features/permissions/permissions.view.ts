import type { AuditEntry, DashboardState } from '../../../shared/types/index.ts';
import { patchHtml } from '../../app/patch.ts';
import { api } from '../../shared/api.ts';
import { elementById } from '../../shared/dom.ts';
import { approvalListHtml } from './permissions.logic.ts';

let seq = 0;

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

/** Wire the Refresh button of the approvals popup. */
export function initPermissions(): void {
  elementById('approvals-refresh').addEventListener('click', () => void loadApprovals());
}
