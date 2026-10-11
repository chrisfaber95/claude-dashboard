import type { CommandResult, DashboardState } from '../../../shared/types/index.ts';
import { api } from '../../shared/api.ts';
import { elementById } from '../../shared/dom.ts';
import { updateSummaryNote } from '../settings/settings.view.ts';
import { resolveSession } from './controls.logic.ts';
import { showToast } from './toast.view.ts';
import { openLogs, openTranscript } from './transcript-drawer-selection.ts';

export { openSubagentTranscript, openTranscript } from './transcript-drawer-selection.ts';

let latestState: DashboardState | null = null;

async function stopSession(id: string, name: string): Promise<void> {
  if (!confirm(`Stop background session ${name}? Its conversation is kept.`)) return;
  try {
    const result = await api<CommandResult>(`/api/sessions/${encodeURIComponent(id)}/stop`, {});
    showToast(result.ok ? 'Stopped.' : result.output || 'Stop failed.', !result.ok);
  } catch (error) {
    showToast((error as Error).message, true);
  }
}

function openRecentLaunch(button: HTMLElement): void {
  const found = latestState ? resolveSession(button.dataset.recent!, latestState.sessions, latestState.recentSessions) : null;
  if (found) openTranscript(found.id, found.isLive ? found.name : (button.dataset.name ?? found.name));
  else showToast('Session not found yet, try again in a moment');
}

async function handleActionClick(event: MouseEvent): Promise<void> {
  const target = event.target as Element;
  const recentButton = target.closest<HTMLElement>('[data-recent]');
  if (recentButton?.dataset.recent) {
    openRecentLaunch(recentButton);
    return;
  }
  const button = target.closest<HTMLElement>('[data-view],[data-logs],[data-stop]');
  if (!button) return;
  const { view, logs, stop, name } = button.dataset;
  if (view) {
    openTranscript(view, name ?? view);
  } else if (logs) {
    await openLogs(logs, name ?? logs);
  } else if (stop) {
    await stopSession(stop, name ?? stop);
  }
}

/** Wire the session action buttons. */
export function initControls(): void {
  try {
    localStorage.removeItem('recentTasks'); // old per-browser history, replaced by the server-side launch history
  } catch {
    // storage unavailable
  }
  document.addEventListener('click', (event) => void handleActionClick(event));
}

/** Called on every state push. Never re-renders the forms, so typing isn't interrupted. */
export function updateControls(state: DashboardState): void {
  latestState = state;
  updateSummaryNote(state.features.commands);
  elementById('run').hidden = !state.features.commands;
  elementById('logout').hidden = !state.features.lan;
}
