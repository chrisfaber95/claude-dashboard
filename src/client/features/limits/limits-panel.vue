<script setup lang="ts">
import { computed } from 'vue';
import { useDashboardState } from '../../app/dashboard-state.ts';
import { ago, until } from '../../shared/time.ts';
import { formatTokenCount } from '../../shared/token-format.ts';
import { tokensToday } from '../popups/popups.logic.ts';
import { clampPercent, highestUtilization, limitLevelClass, limitStatusText } from './limits.logic.ts';

const RECENT_HITS_SHOWN = 3;

const state = useDashboardState();

const limits = computed(() => state.value?.limits ?? null);

const gauges = computed(() =>
  (limits.value?.windows ?? []).map((limitWindow) => {
    const percent = clampPercent(limitWindow.utilization);
    return {
      label: limitWindow.label,
      resetsAtMs: limitWindow.resetsAtMs,
      percent,
      rounded: Math.round(percent),
      levelClass: limitLevelClass(percent),
      statusText: limitStatusText(percent),
    };
  }),
);

const topPercent = computed(() => Math.round(highestUtilization(limits.value?.windows ?? [])));
const topLevelClass = computed(() => limitLevelClass(highestUtilization(limits.value?.windows ?? [])));

const todayText = computed(() => formatTokenCount(state.value ? tokensToday(state.value.usage.days, new Date()) : 0));

const recentHits = computed(() => (limits.value?.hits ?? []).slice(-RECENT_HITS_SHOWN).reverse());
</script>

<template>
  <template v-if="limits">
    <h2 id="h-limits">
      Subscription limits
      <template v-if="gauges.length">
        <span :class="['limits__top', topLevelClass]">{{ topPercent }}%</span>
      </template>
    </h2>
    <p class="limits__today">Tokens today <strong>{{ todayText }}</strong></p>
    <div v-if="gauges.length" class="gauges">
      <div v-for="gauge in gauges" :key="gauge.label" class="gauge" :data-key="gauge.label">
        <div class="gauge__row"><span>{{ gauge.label }}</span><span class="gauge__value">{{ gauge.rounded }}%</span></div>
        <div class="gauge__track" role="progressbar" :aria-valuenow="gauge.rounded" aria-valuemin="0" aria-valuemax="100" :aria-label="`${gauge.label} usage`">
          <div :class="['gauge__fill', gauge.levelClass]" :style="{ width: `${gauge.percent}%` }"></div>
        </div>
        <div class="sub">
          <span data-time="until" :data-ms="gauge.resetsAtMs ?? ''">{{ until(gauge.resetsAtMs) }}</span>{{ gauge.statusText }}
        </div>
      </div>
    </div>
    <div v-else class="empty">No limit data available.</div>
    <p class="sub">
      <template v-if="limits.source === 'live'">live · updated <span data-time="ago" :data-ms="limits.fetchedAtMs ?? ''">{{ ago(limits.fetchedAtMs) }}</span></template>
      <template v-else-if="limits.source === 'cache'">from Claude Code's local cache · updated <span data-time="ago" :data-ms="limits.fetchedAtMs ?? ''">{{ ago(limits.fetchedAtMs) }}</span></template>
      <template v-else>no limit data</template>
      <template v-if="limits.error"> · {{ limits.error }}</template>
    </p>
    <p v-if="recentHits.length" class="sub">
      Last limit hits:
      <template v-for="(hit, index) in recentHits" :key="hit.tsMs">
        <template v-if="index > 0"> · </template>{{ hit.type }} <span data-time="ago" :data-ms="hit.tsMs">{{ ago(hit.tsMs) }}</span> ({{ hit.project }})
      </template>
    </p>
  </template>
</template>
