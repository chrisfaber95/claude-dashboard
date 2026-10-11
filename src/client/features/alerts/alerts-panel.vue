<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useDashboardState } from '../../app/dashboard-state.ts';
import { api } from '../../shared/api.ts';
import RelativeTime from '../../shared/relative-time.vue';
import PermissionRequests from '../permissions/permission-requests.vue';
import { pendingRequests } from '../permissions/permissions.logic.ts';
import { showAlertToast } from './alert-toast.ts';
import { badgeCount, createAlertTracker, MAX_THRESHOLD, MIN_THRESHOLD, parseThreshold, uniqueAlerts } from './alerts.logic.ts';

const state = useDashboardState();
const tracker = createAlertTracker();

const alertItems = computed(() => uniqueAlerts(state.value?.alerts.items ?? []));
const total = computed(() => badgeCount(alertItems.value) + (state.value ? pendingRequests(state.value).length : 0));

const thresholdInput = ref<HTMLInputElement | null>(null);
const thresholdText = ref('');
const statusText = ref('');
const dismissingIds = ref(new Set<string>());

// The first push is only a baseline for toasts; the form is never overwritten while the user types in it.
watch(
  state,
  (current) => {
    if (!current) return;
    for (const item of tracker.update(alertItems.value)) showAlertToast(item);
    if (document.activeElement !== thresholdInput.value) thresholdText.value = String(current.alerts.threshold);
  },
  { immediate: true },
);

// An alert that is gone was dismissed (or cleared): forget it so a returning alert is clickable again.
watch(alertItems, (shown) => {
  const shownIds = new Set(shown.map((item) => item.id));
  for (const id of dismissingIds.value) if (!shownIds.has(id)) dismissingIds.value.delete(id);
});

function onThresholdInput(event: Event): void {
  if (event.target instanceof HTMLInputElement) thresholdText.value = event.target.value;
}

async function dismiss(alertId: string): Promise<void> {
  dismissingIds.value.add(alertId);
  statusText.value = '';
  try {
    await api('/api/alerts/dismiss', { id: alertId });
  } catch {
    dismissingIds.value.delete(alertId);
    statusText.value = 'Could not dismiss the alert.';
  }
}

async function saveThreshold(): Promise<void> {
  const threshold = parseThreshold(thresholdText.value);
  if (threshold === null) {
    statusText.value = 'Enter a whole number from 1 to 100.';
    return;
  }
  statusText.value = '';
  try {
    await api('/api/settings/alerts', { threshold });
    statusText.value = 'Saved.';
  } catch {
    statusText.value = 'Could not save the threshold.';
  }
}
</script>

<template>
  <Teleport to="#alert-badge" defer>
    <span class="alert-badge" role="status" aria-label="Alerts needing attention" :hidden="total === 0">{{ total > 0 ? total : '' }}</span>
  </Teleport>
  <section :class="['panel', 'alerts', { 'has-alerts': total > 0 }]" aria-labelledby="h-alerts">
    <h2 id="h-alerts">
      Needs attention
      <span class="alerts__count" :hidden="total === 0">{{ total > 0 ? total : '' }}</span>
    </h2>
    <ul class="alerts__list">
      <template v-if="total > 0">
        <PermissionRequests context="alerts" />
        <li v-for="item in alertItems" :key="item.id" :class="['alerts__item', `alerts__item--${item.kind}`]" :data-key="item.id">
          <div class="alerts__text">
            <div class="alerts__title">{{ item.title }}</div>
            <div class="sub">{{ item.detail }}</div>
            <div v-if="item.kind === 'usage'" class="sub"><RelativeTime kind="until" :timestamp-ms="item.resetsAtMs" /></div>
          </div>
          <button class="btn btn--sm" type="button" :disabled="dismissingIds.has(item.id)" :aria-label="`Dismiss: ${item.title}`" @click="dismiss(item.id)">Dismiss</button>
        </li>
      </template>
      <li v-else class="empty">Nothing needs attention.</li>
    </ul>
    <form class="alerts__form" @submit.prevent="saveThreshold">
      <label>
        Usage alert threshold (%)
        <input ref="thresholdInput" type="number" :min="MIN_THRESHOLD" :max="MAX_THRESHOLD" step="1" required :value="thresholdText" @input="onThresholdInput" />
      </label>
      <button class="btn btn--sm" type="submit">Save</button>
      <span class="sub" role="status">{{ statusText }}</span>
    </form>
  </section>
</template>
