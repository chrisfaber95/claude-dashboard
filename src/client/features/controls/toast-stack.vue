<script setup lang="ts">
import { useToasts } from './use-toasts.ts';

const toasts = useToasts();
</script>

<template>
  <div v-for="toast in toasts" :key="toast.id" :class="['toast', { 'toast--error': toast.isError }]" role="status">{{ toast.text }}</div>
</template>
