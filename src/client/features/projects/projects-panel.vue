<script setup lang="ts">
import { computed } from 'vue';
import { useDashboardState } from '../../app/dashboard-state.ts';
import RelativeTime from '../../shared/relative-time.vue';
import { projectColor } from '../../shared/project-colors.ts';
import { formatTokenCount } from '../../shared/token-format.ts';
import { useOpenPopup } from '../popups/open-popup.ts';
import { TRUST_TOOLTIP, countWorkingSubagents, subagentsText } from './projects.logic.ts';

const state = useDashboardState();
const openPopup = useOpenPopup();

// Cards are derived only while the Projects popup is open; opening it computes them from the latest push at once.
const cards = computed(() => {
  const current = state.value;
  if (openPopup.value !== 'projects' || !current) return [];
  return current.projects.map((project) => ({
    project,
    color: projectColor(project.name),
    isTrustNoteShown: current.features.commands && !project.trusted,
    subagentsNote: subagentsText(countWorkingSubagents(current.subagents, project.name)),
    todayText: formatTokenCount(project.tokensToday),
    weekText: formatTokenCount(project.tokens7d),
  }));
});
</script>

<template>
  <h2 id="h-projects">Projects</h2>
  <div class="grid">
    <div
      v-for="card in cards"
      :key="card.project.name"
      class="card card--click"
      :data-key="card.project.name"
      :data-building="card.project.name"
      role="button"
      tabindex="0"
      :aria-label="`Open the ${card.project.name} building`"
    >
      <div class="card__head">
        <span><span class="card__swatch" :style="{ background: card.color }"></span>{{ card.project.name }}</span>
        <span :class="['badge', { 'badge--live': card.project.liveSessions }]">
          {{ card.project.liveSessions ? `${card.project.liveSessions} live` : 'idle' }}
        </span>
      </div>
      <div class="sub">
        {{ card.project.branch ? card.project.branch : 'no git' }}{{ card.project.isWorktree ? ' · worktree' : '' }}<template v-if="card.isTrustNoteShown"> · <span :data-tip="TRUST_TOOLTIP">not trusted for tasks</span></template>
      </div>
      <div class="sub">active <RelativeTime kind="ago" :timestamp-ms="card.project.lastActiveMs" />{{ card.subagentsNote }}</div>
      <div class="sub">today {{ card.todayText }} · 7d {{ card.weekText }} tokens</div>
    </div>
  </div>
</template>
