<script setup lang="ts">
import { computed } from 'vue';
import { useDashboardState } from '../../app/dashboard-state.ts';
import RelativeTime from '../../shared/relative-time.vue';
import { useOpenPopup } from '../popups/open-popup.ts';
import { createCityTracker } from './city.logic.ts';
import type { CityTracker } from './city.logic.ts';
import CityView from './city-view.vue';
import { feedKey, routeText } from './messages.logic.ts';

const FEED_ENTRIES_SHOWN = 40;

const state = useDashboardState();
const openPopup = useOpenPopup();

// The tracker keeps shop slots and postman first sightings, so it lives only while the popup is open.
let tracker: CityTracker | null = null;

// Derived only while the Session messages popup is open; opening it computes from the latest push at once.
const view = computed(() => {
  const current = state.value;
  if (openPopup.value !== 'comms' || !current) {
    tracker = null;
    return null;
  }
  tracker ??= createCityTracker();
  const sessionCount = current.messages.filter((message) => message.kind === 'session').length;
  const city = tracker.update({
    sessions: current.sessions,
    messages: current.messages,
    subagents: current.subagents,
    nowMs: Date.now(),
  });
  return {
    city,
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
      <template v-if="view">
        <CityView v-if="view.city.shops.length" :city="view.city" />
        <div v-else class="empty">No sessions or messages found yet.</div>
        <p class="sub">
          {{ view.sessionCount }} session message{{ view.sessionCount === 1 ? '' : 's' }} · {{ view.subagentCount }} subagent hand-back{{ view.subagentCount === 1 ? '' : 's' }} (recent)
        </p>
      </template>
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
