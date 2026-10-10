<script setup lang="ts">
import { ref } from 'vue';

// Sample component for the Vitest setup (T-050): proves `.vue` files compile in tests and external templates work.
defineProps<{ label: string }>();

const count = ref(0);
</script>

<template src="./click-counter.html"></template>
