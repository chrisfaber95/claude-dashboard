<script setup lang="ts">
import { computed, onBeforeUnmount, onErrorCaptured, onMounted, ref, watch } from 'vue';
import AlertsPanel from '../features/alerts/alerts-panel.vue';
import BuildingDialog from '../features/building/building-dialog.vue';
import ToastStack from '../features/controls/toast-stack.vue';
import TranscriptDrawer from '../features/controls/transcript-drawer.vue';
import CoreStrip from '../features/core/core-strip.vue';
import LimitsPanel from '../features/limits/limits-panel.vue';
import PopupShell from '../features/popups/popup-shell.vue';
import SessionsPanel from '../features/sessions/sessions-panel.vue';
import Tooltip from '../features/tooltip/tooltip.vue';
import { setProjectColors } from '../shared/project-colors.ts';
import { tickTimes } from '../shared/time.ts';
import AppHeader from './app-header.vue';
import { useDashboardState } from './dashboard-state.ts';
import { clearLegacyRecentTasks } from './legacy-storage.ts';
import { connectStateStream } from './state-stream.ts';

const TIME_TICK_MS = 10_000;

const state = useDashboardState();
const hasRenderFailure = ref(false);
const hasBadPush = ref(false);
// Fixed text only; the real error goes to the console. Clears itself on the next clean push.
const isWarningShown = computed(() => hasRenderFailure.value || hasBadPush.value);

// Runs before the panels re-render for the same push, so a panel that fails again sets the flag again.
watch(state, (current) => {
  hasRenderFailure.value = false;
  hasBadPush.value = false;
  if (!current) return;
  try {
    setProjectColors(current.projects.map((project) => project.name));
  } catch (error) {
    hasRenderFailure.value = true;
    console.error('project colours failed', error);
  }
});

// One failing panel must not freeze the others or later pushes: show the warning and stop the error here.
onErrorCaptured((error) => {
  hasRenderFailure.value = true;
  console.error('panel failed', error);
  return false;
});

// Relative times ("3m ago", uptime, resets in) advance on their own light tick, writing only the text that changed.
let timeTick: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  clearLegacyRecentTasks();
  timeTick = setInterval(() => tickTimes(), TIME_TICK_MS);
  connectStateStream(() => {
    hasBadPush.value = true;
  });
});
onBeforeUnmount(() => clearInterval(timeTick));
</script>

<template>
  <AppHeader />
  <main>
    <div id="render-warn" class="notice" role="status" :hidden="!isWarningShown">Some sections failed to render. The next update may fix it.</div>
    <section id="core" class="core" aria-labelledby="h-core">
      <CoreStrip />
    </section>
    <nav id="popup-bar" class="popup-bar" aria-label="Open a panel">
      <PopupShell />
    </nav>
    <section id="limits" class="panel" aria-labelledby="h-limits">
      <LimitsPanel />
    </section>
    <div id="alerts">
      <AlertsPanel />
    </div>
    <section id="sessions" class="panel" aria-labelledby="h-sessions">
      <SessionsPanel />
    </section>
  </main>
  <div id="toast-root">
    <ToastStack />
  </div>
  <div id="building-dialog">
    <BuildingDialog />
  </div>
  <div id="transcript-drawer">
    <TranscriptDrawer />
  </div>
  <div id="toasts" class="toasts" role="status" aria-live="polite"></div>
  <div id="tip-root">
    <Tooltip />
  </div>
</template>
