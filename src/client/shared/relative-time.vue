<script setup lang="ts">
import { computed } from 'vue';
import { formatRelativeTime } from './time.ts';
import type { TimeKind } from './time.ts';

const props = defineProps<{
  kind: TimeKind;
  timestampMs: number | null;
}>();

const text = computed(() => formatRelativeTime(props.kind, props.timestampMs));
</script>

<template>
  <span :data-time="kind" :data-ms="timestampMs ?? ''">{{ text }}</span>
</template>
