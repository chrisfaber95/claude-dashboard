<script setup lang="ts">
import { computed, reactive } from 'vue';
import type { TokenCounts, UsageDay } from '../../../shared/types/index.ts';
import { useDashboardState } from '../../app/dashboard-state.ts';
import { projectColor } from '../../shared/project-colors.ts';
import { formatTokenCount } from '../../shared/token-format.ts';
import { useOpenPopup } from '../popups/open-popup.ts';
import { OTHER_SERIES, type BarSegment, daySegments, otherTokensOfDay, seriesNames, visibleDayTotal } from './usage.logic.ts';

const DAYS_SHOWN = 14;
const CHART_WIDTH = 720;
const CHART_HEIGHT = 240;
const MARGIN = { left: 44, right: 8, top: 8, bottom: 24 };
const BAR_INSET_RATIO = 0.15;
const BAR_WIDTH_RATIO = 0.7;
const GRID_FRACTIONS = [0, 0.5, 1];
const HIDDEN_LEGEND_OPACITY = 0.45;
const BAR_GAP = 2;
const LABEL_BASELINE_OFFSET = 6;
const GRID_LABEL_GAP = 6;
const GRID_LABEL_DROP = 4;

const state = useDashboardState();
const openPopup = useOpenPopup();
const hiddenSeries = reactive(new Set<string>());

const seriesColor = (name: string): string => (name === OTHER_SERIES ? 'var(--muted)' : projectColor(name));

const tokenKinds = (tokens: TokenCounts): number[] => [tokens.input, tokens.output, tokens.cacheRead, tokens.cacheWrite];

/** Stack one day's segments bottom-up into rectangles with their colour and tooltip. */
function stackRects(day: string, segments: BarSegment[], valueToY: (tokens: number) => number) {
  let stacked = 0;
  return segments.map(({ name, tokens }) => {
    const top = valueToY(stacked + tokens);
    const height = valueToY(stacked) - top;
    stacked += tokens;
    return {
      key: `${day}|${name}`,
      top,
      height: Math.max(0, height - BAR_GAP),
      color: seriesColor(name),
      tip: `${day}\n${name}: ${formatTokenCount(tokens)} tokens`,
    };
  });
}

function toggleSeries(name: string): void {
  if (hiddenSeries.has(name)) hiddenSeries.delete(name);
  else hiddenSeries.add(name);
}

// Derived only while the Usage popup is open; opening it computes the chart from the latest push at once.
const chart = computed(() => {
  const current = state.value;
  if (openPopup.value !== 'usage' || !current) return null;
  const days: UsageDay[] = current.usage.days.slice(-DAYS_SHOWN);
  const projectNames = current.projects.map((project) => project.name);
  const series = seriesNames(days, projectNames);
  const visibleNames = series.filter((name) => !hiddenSeries.has(name));
  const isOtherHidden = hiddenSeries.has(OTHER_SERIES);
  const max = Math.max(1, ...days.map((day) => visibleDayTotal(day, visibleNames, projectNames, isOtherHidden)));
  const valueToY = (tokens: number): number => MARGIN.top + (CHART_HEIGHT - MARGIN.top - MARGIN.bottom) * (1 - tokens / max);
  const hasOther = days.some((day) => otherTokensOfDay(day, projectNames) > 0);
  const slotWidth = (CHART_WIDTH - MARGIN.left - MARGIN.right) / Math.max(1, days.length);
  const barWidth = slotWidth * BAR_WIDTH_RATIO;

  const legend = (hasOther ? [...series, OTHER_SERIES] : series).map((name) => ({
    name,
    isHidden: hiddenSeries.has(name),
    color: seriesColor(name),
  }));
  const grid = GRID_FRACTIONS.map((fraction) => ({
    fraction,
    lineY: valueToY(max * fraction),
    label: formatTokenCount(max * fraction),
  }));
  const bars = days.map((day, index) => {
    const barX = MARGIN.left + index * slotWidth + slotWidth * BAR_INSET_RATIO;
    const segments = daySegments(day, visibleNames, projectNames, isOtherHidden);
    return { day: day.day, barX, rects: stackRects(day.day, segments, valueToY), labelX: barX + barWidth / 2 };
  });
  const models = Object.entries(current.usage.byModel)
    .sort(([, first], [, second]) => second - first)
    .map(([model, tokens]) => ({ model, tokensText: formatTokenCount(tokens) }));
  return {
    legend,
    grid,
    bars,
    barWidth,
    axisY: CHART_HEIGHT - MARGIN.bottom,
    dayRows: days
      .slice()
      .reverse()
      .map((day) => ({ day: day.day, cells: tokenKinds(day.tokens).map(formatTokenCount) })),
    totals: tokenKinds(current.usage.totals).map(formatTokenCount),
    models,
  };
});
</script>

<template>
  <h2 id="h-usage">Token usage · last 14 days</h2>
  <template v-if="chart">
    <div class="legend">
      <template v-for="entry in chart.legend" :key="entry.name">
        <button
          class="btn legend-btn"
          type="button"
          :data-key="entry.name"
          :aria-pressed="!entry.isHidden"
          :style="{ opacity: entry.isHidden ? HIDDEN_LEGEND_OPACITY : 1 }"
          @click="toggleSeries(entry.name)"
        >
          <i
            :style="{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '3px', marginRight: '6px', background: entry.color }"
          ></i
          >{{ entry.name }}
        </button>
        {{ ' ' }}
      </template>
    </div>
    <svg class="chart" :viewBox="`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`" role="img" aria-label="Daily tokens stacked by project">
      <template v-for="line in chart.grid" :key="line.fraction">
        <line class="grid-line" :x1="MARGIN.left" :x2="CHART_WIDTH - MARGIN.right" :y1="line.lineY" :y2="line.lineY" />
        <text :x="MARGIN.left - GRID_LABEL_GAP" :y="line.lineY + GRID_LABEL_DROP" text-anchor="end">{{ line.label }}</text>
      </template>
      <line class="axis" :x1="MARGIN.left" :x2="CHART_WIDTH - MARGIN.right" :y1="chart.axisY" :y2="chart.axisY" />
      <template v-for="bar in chart.bars" :key="bar.day">
        <rect
          v-for="rect in bar.rects"
          :key="rect.key"
          :data-key="rect.key"
          :x="bar.barX"
          :y="rect.top"
          :width="chart.barWidth"
          :height="rect.height"
          rx="3"
          :style="{ fill: rect.color }"
          :data-tip="rect.tip"
        />
        <text :data-key="`${bar.day}|label`" :x="bar.labelX" :y="CHART_HEIGHT - LABEL_BASELINE_OFFSET" text-anchor="middle">
          {{ bar.day.slice(5) }}
        </text>
      </template>
    </svg>
    <div class="split" :style="{ marginTop: '12px' }">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Day</th>
              <th class="num">Input</th>
              <th class="num">Output</th>
              <th class="num">Cache read</th>
              <th class="num">Cache write</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in chart.dayRows" :key="row.day" :data-key="row.day">
              <td>{{ row.day }}</td>
              <td v-for="(text, index) in row.cells" :key="index" class="num">{{ text }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <th>All time</th>
              <th v-for="(text, index) in chart.totals" :key="index" class="num">{{ text }}</th>
            </tr>
          </tfoot>
        </table>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Model</th>
              <th class="num">Tokens</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in chart.models" :key="entry.model" :data-key="entry.model">
              <td>{{ entry.model }}</td>
              <td class="num">{{ entry.tokensText }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </template>
</template>
