import type { DashboardState, TeamTicket } from '../shared/types.ts';
import { TEAM_COLUMNS } from '../shared/types.ts';
import { forgetHtml, patchHtml } from './patch.ts';
import { $, esc } from './util.ts';

function ticketList(title: string, items: TeamTicket[]): string {
  if (!items.length) return '';
  const rows = items.map((t) => `<li data-key="${esc(t.id)}"><span class="team__id">${esc(t.id)}</span> ${esc(t.title)}</li>`).join('');
  return `<h3 class="h3">${esc(title)}</h3><ul class="team__list">${rows}</ul>`;
}

/** Read-only team board summary. Hidden when the server sends no board; patches only what changed. */
export function renderTeam(s: DashboardState, draw = true): void {
  const el = $('team');
  const t = s.team ?? null;
  if (!t) {
    if (!el.hidden) {
      el.hidden = true;
      el.innerHTML = '';
      forgetHtml(el); // the same markup arriving later must patch again, not be skipped
    }
    return;
  }
  if (!draw) {
    el.hidden = false; // the popup button follows the section; its content renders when the popup opens
    return;
  }
  const tiles = TEAM_COLUMNS.map(
    (c) => `<div class="team__tile team__tile--${esc(c)}" data-key="${esc(c)}"><div class="team__count">${esc(t.counts[c] ?? 0)}</div><div class="sub">${esc(c)}</div></div>`,
  ).join('');
  const needs = t.needsYou.length
    ? `<ul class="team__list">${t.needsYou.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`
    : '<div class="empty">Nothing needs you.</div>';
  const html = `<h2 id="h-team">Team</h2>
    <div class="team__tiles">${tiles}</div>
    ${ticketList('In progress', t.active.inProgress)}${ticketList('Review', t.active.review)}${ticketList('Blocked', t.active.blocked)}
    <h3 class="h3">Needs you</h3>${needs}`;
  patchHtml(el, html);
  el.hidden = false;
}
