import type { DashboardState, RecentSession, SessionInfo } from '../../../shared/types/index.ts';
import { patchHtml } from '../../app/patch.ts';
import { elementById } from '../../shared/dom.ts';
import { esc } from '../../shared/escape.ts';
import { timeSpan } from '../../shared/time.ts';
import { formatTokenCount, sumTokens } from '../../shared/token-format.ts';
import { permissionItemsHtml } from '../permissions/permissions.view.ts';
import { dotStateClass, isBackgroundSession } from './sessions.logic.ts';

const RECENT_SESSIONS_SHOWN = 12;
const SHORT_ID_LENGTH = 8;

function actionsHtml(session: SessionInfo, canControl: boolean): string {
  const id = esc(session.sessionId);
  const name = esc(session.name);
  const buttons = [`<button class="btn btn--sm" data-view="${id}" data-name="${name}">View</button>`];
  if (canControl && isBackgroundSession(session)) {
    buttons.push(`<button class="btn btn--sm" data-logs="${id}" data-name="${name}">Logs</button>`);
    buttons.push(`<button class="btn btn--sm" data-stop="${id}" data-name="${name}">Stop</button>`);
  }
  return buttons.join(' ');
}

function sessionRowHtml(session: SessionInfo, canControl: boolean): string {
  const { tokens } = session;
  const tokenTooltip = `in ${formatTokenCount(tokens.input)} · out ${formatTokenCount(tokens.output)}&#10;cache read ${formatTokenCount(tokens.cacheRead)} · write ${formatTokenCount(tokens.cacheWrite)}`;
  return `<tr data-key="${esc(session.sessionId)}">
      <td><span class="dot ${dotStateClass(session.status)}"></span>${esc(session.name)}${isBackgroundSession(session) ? ' <span class="badge">background</span>' : ''}</td>
      <td>${esc(session.project)}</td><td>${esc(session.status)}</td><td>${session.branch ? esc(session.branch) : '—'}</td>
      <td>${esc(session.entrypoint || session.kind)}</td><td>${timeSpan('up', session.startedAtMs)}</td>
      <td class="num" data-tip="${tokenTooltip}">${formatTokenCount(sumTokens(tokens))}</td>
      <td class="actions">${actionsHtml(session, canControl)}</td></tr>`;
}

function recentItemHtml(recent: RecentSession): string {
  const label = `${esc(recent.project)} · ${esc(recent.sessionId.slice(0, SHORT_ID_LENGTH))}`;
  return `<li data-key="${esc(recent.sessionId)}"><button class="link" data-view="${esc(recent.sessionId)}" data-name="${label}">${label}</button>
        <span class="sub">${timeSpan('ago', recent.lastTsMs)}</span></li>`;
}

/** Draw the live-session table and the recent-session list into `#sessions`. */
export function renderSessions(state: DashboardState): void {
  const canControl = state.features.commands;
  const rows = state.sessions.map((session) => sessionRowHtml(session, canControl)).join('');
  const recent = state.recentSessions
    .filter((session) => !session.live)
    .slice(0, RECENT_SESSIONS_SHOWN)
    .map(recentItemHtml)
    .join('');
  const table = rows
    ? `<div class="table-wrap"><table><thead><tr><th>Session</th><th>Project</th><th>Status</th><th>Branch</th><th>Source</th><th>Up</th><th class="num">Tokens</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows}</tbody></table></div>`
    : '<div class="empty">No live sessions.</div>';
  const recentList = recent ? `<h3 class="h3">Recent sessions</h3><ul class="recent">${recent}</ul>` : '';
  const requests = permissionItemsHtml(state, 'sessions');
  const requestBlock = requests ? `<h3 class="h3">Permission requests</h3><ul class="permissions">${requests}</ul>` : '';
  patchHtml(elementById('sessions'), `<h2 id="h-sessions">Live sessions</h2>${requestBlock}${table}${recentList}`);
}
