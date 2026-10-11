<script setup lang="ts">
import { computed } from 'vue';
import { useOpenPopup } from '../../../../src/client/features/popups/open-popup.ts';

// Test component: a popup panel that only shows content while its own popup (team) is open.
const openPopup = useOpenPopup();
const isTeamOpen = computed(() => openPopup.value === 'team');
</script>

<template>
  <p>{{ isTeamOpen ? 'team is open' : 'team is closed' }}</p>
</template>
