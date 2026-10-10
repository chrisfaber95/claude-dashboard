import type { DashboardState, TeamTicket } from '../../../shared/types/index.ts';
import { TEAM_COLUMNS } from '../../../shared/types/index.ts';
import { forgetHtml, patchHtml } from '../../app/patch.ts';
import { elementById } from '../../shared/dom.ts';
import { esc } from '../../shared/escape.ts';

function ticketList(title: string, items: TeamTicket[]): string {
  if (!items.length) return '';
  const rows = items.map((ticket) => `<li data-key="${esc(ticket.id)}"><span class="team__id">${esc(ticket.id)}</span> ${esc(ticket.title)}</li>`).join('');
  return `<h3 class="h3">${esc(title)}</h3><ul class="team__list">${rows}</ul>`;
}

/** Read-only team board summary. Hidden when the server sends no board; patches only what changed. */
export function renderTeam(state: DashboardState, draw = true): void {
  const section = elementById('team');
  const team = state.team ?? null;
  if (!team) {
    if (!section.hidden) {
      section.hidden = true;
      section.innerHTML = '';
      forgetHtml(section); // the same markup arriving later must patch again, not be skipped
    }
    return;
  }
  if (!draw) {
    section.hidden = false; // the popup button follows the section; its content renders when the popup opens
    return;
  }
  const tiles = TEAM_COLUMNS.map(
    (column) => `<div class="team__tile team__tile--${esc(column)}" data-key="${esc(column)}"><div class="team__count">${esc(team.counts[column] ?? 0)}</div><div class="sub">${esc(column)}</div></div>`,
  ).join('');
  const needs = team.needsYou.length
    ? `<ul class="team__list">${team.needsYou.map((name) => `<li>${esc(name)}</li>`).join('')}</ul>`
    : '<div class="empty">Nothing needs you.</div>';
  const html = `<h2 id="h-team">Team</h2>
    <div class="team__tiles">${tiles}</div>
    ${ticketList('In progress', team.active.inProgress)}${ticketList('Review', team.active.review)}${ticketList('Blocked', team.active.blocked)}
    <h3 class="h3">Needs you</h3>${needs}`;
  patchHtml(section, html);
  section.hidden = false;
}
