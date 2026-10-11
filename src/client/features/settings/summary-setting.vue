<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { SummaryMode, SummarySetting } from '../../../shared/types/index.ts';
import { SUMMARY_MODES } from '../../../shared/types/index.ts';
import { useDashboardState } from '../../app/dashboard-state.ts';
import { api } from '../../shared/api.ts';

const MODE_LABELS = {
  recap: 'Recap (no model)',
  model: 'Model (haiku, one CLI call)',
} satisfies Record<SummaryMode, string>;

// Status texts are fixed strings: server error text never reaches the page.
const state = useDashboardState();
const selectedMode = ref<string>(SUMMARY_MODES[0] ?? 'recap');
const savedMode = ref<string>(selectedMode.value);
const statusText = ref('');

// With commands off, `model` still saves but summaries fall back to the recap.
const isNoteShown = computed(() => state.value?.features.commands === false && savedMode.value === 'model');

async function load(): Promise<void> {
  try {
    const setting = await api<SummarySetting>('/api/settings/summary');
    if (!SUMMARY_MODES.includes(setting.summary)) return;
    savedMode.value = setting.summary;
    selectedMode.value = setting.summary;
  } catch {
    statusText.value = 'Could not load the summary setting.';
  }
}

async function save(): Promise<void> {
  const next = selectedMode.value;
  statusText.value = '';
  try {
    await api<SummarySetting>('/api/settings/summary', { summary: next });
    savedMode.value = next;
    statusText.value = 'Saved.';
  } catch {
    selectedMode.value = savedMode.value;
    statusText.value = 'Could not save the summary setting.';
  }
}

onMounted(load);
</script>

<template>
  <label>Session summaries
    <select id="summary-mode" v-model="selectedMode" @change="save">
      <option v-for="mode in SUMMARY_MODES" :key="mode" :value="mode">{{ MODE_LABELS[mode] }}</option>
    </select>
  </label>
  <span id="summary-status" class="sub" role="status">{{ statusText }}</span>
  <span id="summary-note" class="sub" :hidden="!isNoteShown">Commands are off, so summaries use the recap.</span>
</template>
