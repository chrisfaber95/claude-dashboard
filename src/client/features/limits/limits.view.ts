import type { DashboardState, LimitHit, LimitWindow, LimitsInfo } from '../../../shared/types/index.ts';
import { patchHtml } from '../../app/patch.ts';
import { elementById } from '../../shared/dom.ts';
import { esc } from '../../shared/escape.ts';
import { timeSpan } from '../../shared/time.ts';
import { formatTokenCount } from '../../shared/token-format.ts';
import { tokensToday } from '../popups/popups.logic.ts';
import { clampPercent, highestUtilization, limitLevelClass, limitStatusText } from './limits.logic.ts';

const RECENT_HITS_SHOWN = 3;

function gaugeHtml(limitWindow: LimitWindow): string {
  const percent = clampPercent(limitWindow.utilization);
  const levelClass = limitLevelClass(percent);
  return `<div class="gauge" data-key="${esc(limitWindow.label)}">
        <div class="gauge__row"><span>${esc(limitWindow.label)}</span><span class="gauge__value">${Math.round(percent)}%</span></div>
        <div class="gauge__track" role="progressbar" aria-valuenow="${Math.round(percent)}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(limitWindow.label)} usage">
          <div class="gauge__fill ${levelClass}" style="width:${percent}%"></div></div>
        <div class="sub">${timeSpan('until', limitWindow.resetsAtMs)}${limitStatusText(percent)}</div></div>`;
}

function hitsHtml(hits: readonly LimitHit[]): string {
  if (!hits.length) return '';
  const recent = hits
    .slice(-RECENT_HITS_SHOWN)
    .reverse()
    .map((hit) => `${esc(hit.type)} ${timeSpan('ago', hit.tsMs)} (${esc(hit.project)})`)
    .join(' · ');
  return `<p class="sub">Last limit hits: ${recent}</p>`;
}

function sourceText(limits: LimitsInfo): string {
  if (limits.source === 'live') return `live · updated ${timeSpan('ago', limits.fetchedAtMs)}`;
  if (limits.source === 'cache') return `from Claude Code's local cache · updated ${timeSpan('ago', limits.fetchedAtMs)}`;
  return 'no limit data';
}

/** Draw the subscription limit gauges into `#limits`. */
export function renderLimits(state: DashboardState): void {
  const limits = state.limits;
  const gauges = limits.windows.map(gaugeHtml).join('');
  const top = highestUtilization(limits.windows);
  const topBadge = limits.windows.length ? ` <span class="limits__top ${limitLevelClass(top)}">${Math.round(top)}%</span>` : '';
  const html = `<h2 id="h-limits">Subscription limits${topBadge}</h2>
    <p class="limits__today">Tokens today <strong>${formatTokenCount(tokensToday(state.usage.days, new Date()))}</strong></p>
    ${gauges ? `<div class="gauges">${gauges}</div>` : '<div class="empty">No limit data available.</div>'}
    <p class="sub">${sourceText(limits)}${limits.error ? ` · ${esc(limits.error)}` : ''}</p>${hitsHtml(limits.hits)}`;
  patchHtml(elementById('limits'), html);
}
