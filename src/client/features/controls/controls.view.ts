import type { CommandResult, DashboardState } from '../../../shared/types/index.ts';
import { api } from '../../shared/api.ts';
import { elementById } from '../../shared/dom.ts';
import { esc } from '../../shared/escape.ts';
import { updateSummaryNote } from '../settings/settings.view.ts';
import { resolveSession } from './controls.logic.ts';
import { initDrawer, loadEarlier, openLogs, openTranscript, updateDrawer } from './drawer.view.ts';
import { loadLaunches, renderLaunches } from './launches.view.ts';
import { initRunForm } from './run-form.view.ts';
import { showToast } from './toast.view.ts';

export { openSubagentTranscript, openTranscript } from './drawer.view.ts';

const DEFAULT_PERMISSION_MODE = 'auto';

let latestState: DashboardState | null = null;
let projectKey = '';
let hasFilledModes = false;

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
  const button = target.closest<HTMLElement>('[data-view],[data-logs],[data-stop],[data-more]');
  if (!button) return;
  const { more, view, logs, stop, name } = button.dataset;
  if (more !== undefined) {
    await loadEarlier().catch((error) => showToast((error as Error).message, true));
  } else if (view) {
    openTranscript(view, name ?? view);
  } else if (logs) {
    await openLogs(logs, name ?? logs);
  } else if (stop) {
    await stopSession(stop, name ?? stop);
  }
}

/** Wire the run panel, the launch history, the transcript drawer and the session action buttons. */
export function initControls(): void {
  try {
    localStorage.removeItem('recentTasks'); // old per-browser history, replaced by the server-side launch history
  } catch {
    // storage unavailable
  }
  void loadLaunches();
  document.addEventListener('click', (event) => {
    if ((event.target as Element).closest('[data-popup="run"]')) void loadLaunches();
  });
  document.addEventListener('click', (event) => void handleActionClick(event));
  initDrawer();
  initRunForm(() => void loadLaunches());
}

function fillPermissionModes(state: DashboardState): void {
  if (hasFilledModes) return;
  const options = state.features.permissionModes
    .map((mode) => `<option value="${esc(mode)}"${mode === DEFAULT_PERMISSION_MODE ? ' selected' : ''}>${esc(mode)}</option>`)
    .join('');
  elementById('run-mode').innerHTML = options;
  elementById('drawer-mode').innerHTML = options;
  hasFilledModes = true;
}

function fillProjectOptions(state: DashboardState): void {
  const key = state.projects.map((project) => `${project.name}:${project.trusted}`).join('|');
  if (key === projectKey) return;
  const select = elementById<HTMLSelectElement>('run-project');
  const current = select.value;
  select.innerHTML = state.projects
    .map((project) => `<option value="${esc(project.name)}">${esc(project.name)}${project.trusted ? '' : ' (not trusted yet)'}</option>`)
    .join('');
  if (current && state.projects.some((project) => project.name === current)) select.value = current;
  projectKey = key;
}

/** Called on every state push. Never re-renders the forms, so typing isn't interrupted. */
export function updateControls(state: DashboardState): void {
  latestState = state;
  renderLaunches(state);
  updateSummaryNote(state.features.commands);
  elementById('run').hidden = !state.features.commands;
  elementById('logout').hidden = !state.features.lan;
  updateDrawer(state);
  fillPermissionModes(state);
  fillProjectOptions(state);
}
