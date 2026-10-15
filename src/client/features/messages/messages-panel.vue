<script setup lang="ts">
import { computed, ref } from 'vue';
import { useDashboardState } from '../../app/dashboard-state.ts';
import RelativeTime from '../../shared/relative-time.vue';
import { useOpenPopup } from '../popups/open-popup.ts';
import { createKingdomTracker } from './kingdom.logic.ts';
import type { KingdomTracker } from './kingdom.logic.ts';
import { createKingdomLayoutTracker } from './kingdom-layout.logic.ts';
import type { KingdomLayoutTracker } from './kingdom-layout.logic.ts';
import KingdomView from './kingdom-view.vue';
import { feedKey, routeText } from './messages.logic.ts';
import { useSceneOrientation } from './use-scene-orientation.ts';

const FEED_ENTRIES_SHOWN = 40;

const state = useDashboardState();
const openPopup = useOpenPopup();
const sceneArea = ref<HTMLElement | null>(null);
const orientation = useSceneOrientation(sceneArea);

// The trackers keep slots, plots and first sightings, so they live only while the popup is open.
let kingdomTracker: KingdomTracker | null = null;
let layoutTracker: KingdomLayoutTracker | null = null;

// Derived only while the Session messages popup is open; opening it computes from the latest push at once.
const view = computed(() => {
  const current = state.value;
  if (openPopup.value !== 'comms' || !current) {
    kingdomTracker = null;
    layoutTracker = null;
    return null;
  }
  kingdomTracker ??= createKingdomTracker();
  layoutTracker ??= createKingdomLayoutTracker();
  const sessionCount = current.messages.filter((message) => message.kind === 'session').length;
  const kingdom = kingdomTracker.update({
    sessions: current.sessions,
    messages: current.messages,
    subagents: current.subagents,
    alerts: current.alerts.items,
    permissions: current.permissions,
    nowMs: Date.now(),
  });
  return {
    kingdom,
    layout: layoutTracker.arrange(kingdom, orientation.value),
    hasBuildings: kingdom.areas.some((area) => area.buildings.length > 0),
    sessionCount,
    subagentCount: current.messages.length - sessionCount,
    feed: current.messages.slice(0, FEED_ENTRIES_SHOWN),
  };
});
</script>

<template>
  <h2 id="h-comms">Session communication</h2>
  <div class="split">
    <div>
      <div ref="sceneArea" :class="['kingdom-area', `kingdom-area--${orientation}`]">
        <template v-if="view">
          <KingdomView v-if="view.hasBuildings" :kingdom="view.kingdom" :layout="view.layout" />
          <div v-else class="empty">No sessions or messages found yet.</div>
        </template>
      </div>
      <p v-if="view" class="sub">
        {{ view.sessionCount }} session message{{ view.sessionCount === 1 ? '' : 's' }} · {{ view.subagentCount }} subagent hand-back{{ view.subagentCount === 1 ? '' : 's' }} (recent)
      </p>
    </div>
    <ul class="feed">
      <li v-for="message in view?.feed ?? []" :key="feedKey(message)" :data-key="feedKey(message)">
        <div class="feed__meta">
          {{ routeText(message) }} · {{ message.kind === 'subagent' ? 'subagent hand-back' : 'session message' }} ·
          <RelativeTime kind="ago" :timestamp-ms="message.tsMs" />
        </div>
        <div>{{ message.snippet }}</div>
      </li>
      <li v-if="view && !view.feed.length" class="empty">Nothing yet.</li>
    </ul>
  </div>
</template>
