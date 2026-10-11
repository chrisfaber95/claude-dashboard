<script setup lang="ts">
import { selectDashboardState } from '../../../src/client/app/dashboard-state.ts';

// Test component: shows how many sessions the latest push holds.
const sessionCount = selectDashboardState((state) => state.sessions.length);
</script>

<template>
  <p>{{ sessionCount === null ? 'waiting' : `${sessionCount} sessions` }}</p>
</template>
