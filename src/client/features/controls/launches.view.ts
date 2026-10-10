import type { AuditEntry, DashboardState } from '../../../shared/types/index.ts';
import { patchHtml } from '../../app/patch.ts';
import { api } from '../../shared/api.ts';
import { elementById } from '../../shared/dom.ts';
import { esc } from '../../shared/escape.ts';
import { ago } from '../../shared/time.ts';
import { launchRow, launchState } from '../launch/launch.logic.ts';
import type { LaunchRow } from '../launch/launch.logic.ts';
import { matchSession } from './controls.logic.ts';

// Server-side history from GET /api/launches, the same on every device.
let launches: AuditEntry[] = [];
let latestState: DashboardState | null = null;

function launchItemHtml(row: LaunchRow): string {
  const isRunning = Boolean(row.session && latestState && matchSession(latestState.sessions, row.session));
  const state = launchState(row, isRunning);
  const stateClass = `${state === 'running' ? ' is-live' : ''}${state === 'failed' ? ' is-failed' : ''}`;
  const viewButton = row.session
    ? `<button class="btn btn--sm" type="button" data-recent="${esc(row.session)}" data-name="${esc(row.project)}">View</button>`
    : '';
  return `<li class="recent__item${stateClass}" data-key="${esc(row.key)}">
        <span class="recent__dot" aria-hidden="true"></span>
        <span class="recent__main"><span class="recent__project">${esc(row.project)}</span>
          <span class="recent__prompt">${esc(row.goal)}</span>
          <span class="sub"><span class="recent__time">${esc(ago(row.tsMs))}</span> · ${esc(row.device)} · <span class="recent__state">${esc(state)}</span></span></span>
        ${viewButton}
      </li>`;
}

/** Patches the launch list in place (running / not live and relative time); rows keep their nodes. */
export function renderLaunches(state: DashboardState | null = latestState): void {
  latestState = state;
  elementById('recent').hidden = launches.length === 0;
  patchHtml(elementById('recent-list'), launches.map(launchRow).map(launchItemHtml).join(''));
}

/** Fetch the launch history and redraw the list; on failure the list we have stays. */
export async function loadLaunches(): Promise<void> {
  try {
    launches = (await api<{ launches: AuditEntry[] }>('/api/launches')).launches;
    renderLaunches();
  } catch {
    // keep the list we have; the next load retries
  }
}
