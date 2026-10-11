<script setup lang="ts">
import { computed, watchEffect } from 'vue';
import { useDashboardState } from '../../app/dashboard-state.ts';
import { CORE_LABEL, coreHeadlineParts, coreSummary } from './mood.logic.ts';
import type { CoreMood } from './mood.logic.ts';

const HOST_ID = 'core';
const MOOD_CLASSES = ['core--standby', 'core--working', 'core--waiting'];
const BAR_INDEXES = Array.from({ length: 41 }, (_, index) => index);
const RIPPLE_INDEXES = [0, 1, 2];
const THINK_DOT_INDEXES = [0, 1, 2];

const state = useDashboardState();

const summary = computed(() => (state.value ? coreSummary(state.value) : null));
// A string, so a push that keeps the same mood does not re-run the effect below.
const mood = computed<CoreMood | null>(() => summary.value?.mood ?? null);
const labelText = computed(() => (mood.value ? CORE_LABEL[mood.value] : ''));
const headline = computed(() => (summary.value ? coreHeadlineParts(summary.value) : { lead: '', accent: '' }));

// The skins style the mood on the section itself (it is the grid item), so the class goes on the mount host, and
// data-mood on <html> is what the Root scene reads.
watchEffect(() => {
  const host = document.getElementById(HOST_ID);
  if (!host || !mood.value) return;
  host.classList.remove(...MOOD_CLASSES);
  host.classList.add(`core--${mood.value}`);
  document.documentElement.setAttribute('data-mood', mood.value);
}, { flush: 'post' }); // post: the host section is only in the page once the app is mounted
</script>

<template>
  <h2 id="h-core" class="sr-only">Assistant status</h2>
  <!-- One live region around pill and headline, so the headline is announced too. -->
  <div class="core__live" role="status">
    <div class="core__pill">
      <span class="core__dot"></span>
      <span class="core__label">{{ labelText }}</span>
    </div>
    <p class="core__headline">
      <span class="core__lead">{{ headline.lead }}</span>
      <span class="core__accent">{{ headline.accent }}</span>
    </p>
  </div>
  <div class="core__eq" aria-hidden="true">
    <span v-for="index in BAR_INDEXES" :key="index" class="core__bar"></span>
  </div>
  <div class="core__scan" aria-hidden="true">
    <div class="core__sweep"></div>
    <div class="core__segments"></div>
  </div>
  <div class="core__badge" aria-hidden="true">
    <span class="core__badge-mic"></span>
  </div>
  <!-- Root skin parts (hidden in Co-pilot). root-scene.ts adds the seed artwork into the empty seed div. -->
  <div class="core__seedwrap" aria-hidden="true">
    <span v-for="index in RIPPLE_INDEXES" :key="index" class="core__ripple"></span>
    <div class="core__seed"></div>
  </div>
  <div class="core__think" aria-hidden="true">
    <span v-for="index in THINK_DOT_INDEXES" :key="index" class="core__think-dot"></span>
  </div>
</template>
