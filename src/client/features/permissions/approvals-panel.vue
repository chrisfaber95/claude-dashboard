<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { AuditEntry } from '../../../shared/types/index.ts';
import { useDashboardState } from '../../app/dashboard-state.ts';
import { api } from '../../shared/api.ts';
import { useOpenPopup } from '../popups/open-popup.ts';
import { approvalEntriesOf, approvalRowOf } from './permissions.logic.ts';

// Fixed texts only: raw server or exception text never reaches the page.
const LOADING_TEXT = 'Loading...';
const ERROR_TEXT = 'Could not load the approvals.';

const state = useDashboardState();
const openPopup = useOpenPopup();
const entries = ref<AuditEntry[]>([]);
const statusText = ref('');
const isLoading = ref(false);
let latestRequest = 0;

// The log is only reachable while commands are allowed (same rule as the Run popup).
const isShown = computed(() => state.value?.features.commands === true);
const shouldLoad = computed(() => isShown.value && openPopup.value === 'approvals');
const rows = computed(() => entries.value.map(approvalRowOf));

/** Fetch the log; a response that arrives after a newer request is ignored. */
async function load(): Promise<void> {
  const thisRequest = ++latestRequest;
  isLoading.value = true;
  statusText.value = LOADING_TEXT;
  try {
    const loaded = approvalEntriesOf(await api<unknown>('/api/approvals'));
    if (thisRequest !== latestRequest) return;
    if (loaded === null) {
      statusText.value = ERROR_TEXT;
      return;
    }
    entries.value = loaded;
    statusText.value = '';
  } catch {
    if (thisRequest === latestRequest) statusText.value = ERROR_TEXT;
  } finally {
    if (thisRequest === latestRequest) isLoading.value = false;
  }
}

// Data loads when the popup opens and on Refresh only; a state push has nothing to do here.
watch(
  shouldLoad,
  (should) => {
    if (should) void load();
  },
  { immediate: true },
);
</script>

<template>
  <template v-if="isShown">
    <h2 id="h-approvals">Approvals</h2>
    <div class="approvals__bar">
      <button id="approvals-refresh" class="btn btn--sm" type="button" :disabled="isLoading" @click="load()">Refresh</button>
      <span id="approvals-status" class="sub" role="status">{{ statusText }}</span>
    </div>
    <ul id="approvals-list" class="approvals__list">
      <li v-for="(row, index) in rows" :key="index" class="approvals__item">
        <div class="approvals__line">
          <span class="approvals__time sub">{{ row.time }}</span>
          <span class="approvals__device">{{ row.device }}</span>
          <span v-if="row.session" class="approvals__session">{{ row.session }}</span>
          <strong v-if="row.tool" class="approvals__tool">{{ row.tool }}</strong>
          <span :class="['approvals__outcome', `approvals__outcome--${row.outcomeClass}`]">{{ row.outcome }}</span>
        </div>
        <div v-if="row.text" class="permission__text">{{ row.text }}</div>
      </li>
      <li v-if="rows.length === 0 && statusText === ''" class="empty">No approvals yet.</li>
    </ul>
  </template>
</template>
