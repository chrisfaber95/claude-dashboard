import type { DashboardState, UsageDay } from '../../../shared/types/index.ts';
import { patchHtml } from '../../app/patch.ts';
import { elementById } from '../../shared/dom.ts';
import { esc } from '../../shared/escape.ts';
import { projectColor } from '../../shared/project-colors.ts';
import { formatTokenCount } from '../../shared/token-format.ts';
import { OTHER_SERIES, daySegments, otherTokensOfDay, seriesNames, visibleDayTotal } from './usage.logic.ts';

const DAYS_SHOWN = 14;
const CHART_WIDTH = 720;
const CHART_HEIGHT = 240;
const MARGIN = { left: 44, right: 8, top: 8, bottom: 24 };
const BAR_INSET_RATIO = 0.15;
const BAR_WIDTH_RATIO = 0.7;
const GRID_FRACTIONS = [0, 0.5, 1];
const HIDDEN_LEGEND_OPACITY = 0.45;

const hiddenSeries = new Set<string>();

type ValueToY = (tokens: number) => number;

const seriesColor = (name: string) => (name === OTHER_SERIES ? 'var(--muted)' : projectColor(name));

function gridHtml(max: number, valueToY: ValueToY): string {
  return GRID_FRACTIONS.map((fraction) => {
    const lineY = valueToY(max * fraction);
    return `<line class="grid-line" x1="${MARGIN.left}" x2="${CHART_WIDTH - MARGIN.right}" y1="${lineY}" y2="${lineY}"/><text x="${MARGIN.left - 6}" y="${lineY + 4}" text-anchor="end">${formatTokenCount(max * fraction)}</text>`;
  }).join('');
}

function barsHtml(days: UsageDay[], visibleNames: string[], projectNames: string[], valueToY: ValueToY): string {
  const slotWidth = (CHART_WIDTH - MARGIN.left - MARGIN.right) / Math.max(1, days.length);
  return days
    .map((day, index) => {
      let stacked = 0;
      const barX = MARGIN.left + index * slotWidth + slotWidth * BAR_INSET_RATIO;
      const width = slotWidth * BAR_WIDTH_RATIO;
      const rects = daySegments(day, visibleNames, projectNames, hiddenSeries.has(OTHER_SERIES))
        .map(({ name, tokens }) => {
          const top = valueToY(stacked + tokens);
          const height = valueToY(stacked) - top;
          stacked += tokens;
          return `<rect data-key="${esc(`${day.day}|${name}`)}" x="${barX}" y="${top}" width="${width}" height="${Math.max(0, height - 2)}" rx="3" style="fill:${seriesColor(name)}" data-tip="${esc(day.day)}&#10;${esc(name)}: ${formatTokenCount(tokens)} tokens"/>`;
        })
        .join('');
      return `${rects}<text data-key="${esc(`${day.day}|label`)}" x="${barX + width / 2}" y="${CHART_HEIGHT - 6}" text-anchor="middle">${day.day.slice(5)}</text>`;
    })
    .join('');
}

function legendHtml(names: string[]): string {
  return names
    .map((name) => {
      const isHidden = hiddenSeries.has(name);
      return `<button class="btn legend-btn" data-key="${esc(name)}" data-toggle="${esc(name)}" aria-pressed="${!isHidden}" style="opacity:${isHidden ? HIDDEN_LEGEND_OPACITY : 1}"><i style="display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;background:${seriesColor(name)}"></i>${esc(name)}</button>`;
    })
    .join(' ');
}

function tokenCells(tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }, cellTag: 'td' | 'th'): string {
  return [tokens.input, tokens.output, tokens.cacheRead, tokens.cacheWrite]
    .map((count) => `<${cellTag} class="num">${formatTokenCount(count)}</${cellTag}>`)
    .join('');
}

function dayTableHtml(days: UsageDay[], state: DashboardState): string {
  const rows = days
    .slice()
    .reverse()
    .map((day) => `<tr data-key="${esc(day.day)}"><td>${esc(day.day)}</td>${tokenCells(day.tokens, 'td')}</tr>`)
    .join('');
  return `<div class="table-wrap"><table><thead><tr><th>Day</th><th class="num">Input</th><th class="num">Output</th><th class="num">Cache read</th><th class="num">Cache write</th></tr></thead><tbody>${rows}</tbody>
      <tfoot><tr><th>All time</th>${tokenCells(state.usage.totals, 'th')}</tr></tfoot></table></div>`;
}

function modelTableHtml(state: DashboardState): string {
  const rows = Object.entries(state.usage.byModel)
    .sort(([, a], [, b]) => b - a)
    .map(([model, tokens]) => `<tr data-key="${esc(model)}"><td>${esc(model)}</td><td class="num">${formatTokenCount(tokens)}</td></tr>`)
    .join('');
  return `<div class="table-wrap"><table><thead><tr><th>Model</th><th class="num">Tokens</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/** Draw the stacked daily token chart, its legend and the usage tables into `#usage`. */
export function renderUsage(state: DashboardState): void {
  const days = state.usage.days.slice(-DAYS_SHOWN);
  const projectNames = state.projects.map((project) => project.name);
  const series = seriesNames(days, projectNames);
  const visibleNames = series.filter((name) => !hiddenSeries.has(name));
  const isOtherHidden = hiddenSeries.has(OTHER_SERIES);
  const max = Math.max(1, ...days.map((day) => visibleDayTotal(day, visibleNames, projectNames, isOtherHidden)));
  const valueToY: ValueToY = (tokens) => MARGIN.top + (CHART_HEIGHT - MARGIN.top - MARGIN.bottom) * (1 - tokens / max);
  const hasOther = days.some((day) => otherTokensOfDay(day, projectNames) > 0);
  const legendNames = hasOther ? [...series, OTHER_SERIES] : series;
  const axisY = CHART_HEIGHT - MARGIN.bottom;

  patchHtml(elementById('usage'), `<h2 id="h-usage">Token usage · last 14 days</h2>
    <div class="legend">${legendHtml(legendNames)}</div>
    <svg class="chart" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" role="img" aria-label="Daily tokens stacked by project">${gridHtml(max, valueToY)}<line class="axis" x1="${MARGIN.left}" x2="${CHART_WIDTH - MARGIN.right}" y1="${axisY}" y2="${axisY}"/>${barsHtml(days, visibleNames, projectNames, valueToY)}</svg>
    <div class="split" style="margin-top:12px">${dayTableHtml(days, state)}
      ${modelTableHtml(state)}</div>`);
}

/** Legend clicks toggle a series and redraw from the latest state. */
export function initUsage(getLatestState: () => DashboardState | null): void {
  document.addEventListener('click', (event) => {
    const button = (event.target as Element).closest('[data-toggle]');
    if (!button) return;
    const name = button.getAttribute('data-toggle')!;
    if (hiddenSeries.has(name)) hiddenSeries.delete(name);
    else hiddenSeries.add(name);
    const state = getLatestState();
    if (state) renderUsage(state);
  });
}
