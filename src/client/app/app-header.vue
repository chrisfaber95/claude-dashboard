<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useAppearance } from './appearance.ts';
import { getGreeting } from './greeting.logic.ts';
import { useDashboardState } from './dashboard-state.ts';
import { useConnectionStatus } from './state-stream.ts';

const state = useDashboardState();
const connectionStatus = useConnectionStatus();
const { skin, isThemeToggleHidden, chooseSkin, toggleTheme } = useAppearance();

const connectionText = computed(() => {
  if (connectionStatus.value === 'live') return 'live';
  return connectionStatus.value === 'reconnecting' ? 'reconnecting…' : 'connecting…';
});
const GREETING_REFRESH_MS = 60_000;
const now = ref(new Date());
const refreshTimer = setInterval(() => {
  now.value = new Date();
}, GREETING_REFRESH_MS);
onBeforeUnmount(() => clearInterval(refreshTimer));
const greeting = computed(() => getGreeting(skin.value, now.value));
const isLogoutHidden = computed(() => !state.value?.features.lan);

function onSkinChange(event: Event): void {
  if (event.target instanceof HTMLSelectElement) chooseSkin(event.target.value);
}
</script>

<template>
  <header class="top">
    <h1>Claude Dashboard</h1>
    <div class="top__meta">
      <span id="greeting" class="top__greeting">{{ greeting }}</span>
      <span id="alert-badge" class="alert-badge-slot"></span>
      <span id="conn" :class="['conn', { 'is-live': connectionStatus === 'live' }]">{{ connectionText }}</span>
      <select id="skin" aria-label="Skin" :value="skin" @change="onSkinChange">
        <option value="classic">Classic</option>
        <option value="copilot">Co-pilot</option>
        <option value="root">Root</option>
      </select>
      <button id="theme" class="btn" type="button" aria-label="Toggle theme" :hidden="isThemeToggleHidden" @click="toggleTheme">Theme</button>
      <form id="logout" method="post" action="/logout" :hidden="isLogoutHidden"><button class="btn" type="submit">Log out</button></form>
    </div>
  </header>
</template>
