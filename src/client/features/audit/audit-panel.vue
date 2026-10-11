<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { AuditEntry } from '../../../shared/types/index.ts';
import { api, ApiError } from '../../shared/api.ts';
import { useOpenPopup } from '../popups/open-popup.ts';
import { ALL_DEVICES, auditQuery, mergeDeviceOptions, rowOf } from './audit.logic.ts';
import type { DeviceOption } from './audit.logic.ts';

// Only these server strings may reach the page; anything else becomes the generic message.
const KNOWN_ERRORS = new Set(['invalid device filter', 'could not read the audit log']);
const GENERIC_ERROR = 'Could not load the activity.';

const openPopup = useOpenPopup();
const selectedDevice = ref(ALL_DEVICES);
const knownDevices = ref<DeviceOption[]>([]);
const entries = ref<AuditEntry[]>([]);
const statusText = ref('');
const isLoading = ref(false);
let latestRequest = 0;

const rows = computed(() => entries.value.map(rowOf));

// The selected device stays selectable even when no entry lists it any more.
const deviceOptions = computed(() => {
  const selected = selectedDevice.value;
  const isListed = selected === ALL_DEVICES || knownDevices.value.some((option) => option.id === selected);
  return isListed ? knownDevices.value : [...knownDevices.value, { id: selected, name: selected }];
});

function errorText(error: unknown): string {
  return error instanceof ApiError && KNOWN_ERRORS.has(error.message) ? error.message : GENERIC_ERROR;
}

/** Fetch the log for the selected device; a response that arrives after a newer request is ignored. */
async function load(): Promise<void> {
  const thisRequest = ++latestRequest;
  isLoading.value = true;
  statusText.value = 'Loading...';
  try {
    const response = await api<{ entries: AuditEntry[] }>(`/api/audit${auditQuery(selectedDevice.value)}`);
    if (thisRequest !== latestRequest) return;
    knownDevices.value = mergeDeviceOptions(knownDevices.value, response.entries);
    entries.value = response.entries;
    statusText.value = '';
  } catch (error) {
    if (thisRequest !== latestRequest) return;
    // Don't leave rows from another filter on screen next to an error.
    entries.value = [];
    statusText.value = errorText(error);
  } finally {
    if (thisRequest === latestRequest) isLoading.value = false;
  }
}

// Data loads on open, filter change and Refresh only; a state push has nothing to do here.
watch(
  () => openPopup.value === 'audit',
  (isOpen) => {
    if (isOpen) void load();
  },
  { immediate: true },
);
watch(selectedDevice, () => void load());
</script>

<template>
  <h2 id="h-audit" class="audit__summary">Activity</h2>
  <div class="audit__bar">
    <label>
      Device
      <select v-model="selectedDevice" id="audit-device">
        <option :value="ALL_DEVICES">All devices</option>
        <option v-for="option in deviceOptions" :key="option.id" :value="option.id">{{ option.name }}</option>
      </select>
    </label>
    <button id="audit-refresh" class="btn btn--sm" type="button" :disabled="isLoading" @click="load()">Refresh</button>
    <span id="audit-status" class="sub" role="status">{{ statusText }}</span>
  </div>
  <ul id="audit-list" class="audit__list">
    <li v-for="(row, index) in rows" :key="index" class="audit__item">
      <div class="audit__line">
        <span class="audit__time sub">{{ row.time }}</span>
        <strong class="audit__device">{{ row.device }}</strong>
        <span class="audit__action">{{ row.action }}</span>
        <span v-if="row.target" class="audit__target">{{ row.target }}</span>
        <span v-if="row.result" :class="['audit__result', `audit__result--${row.result}`]">{{ row.result }}</span>
      </div>
      <div v-if="row.prompt" class="audit__prompt" :data-tip="row.prompt">{{ row.prompt }}</div>
    </li>
    <li v-if="rows.length === 0 && statusText === ''" class="empty">No activity yet.</li>
  </ul>
</template>
