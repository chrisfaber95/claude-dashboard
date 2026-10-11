<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue';

// A single-word file name would trip vue/multi-word-component-names.
defineOptions({ name: 'DashboardTooltip' });

const POINTER_OFFSET_PX = 14;
const VIEWPORT_MARGIN_PX = 8;

const tooltip = ref<HTMLElement | null>(null);
const text = ref('');
const isHidden = ref(true);
const leftPx = ref(0);
const topPx = ref(0);

// Tip text is plain text (newlines allowed): attribute values come back entity-decoded, so never use v-html.
/** Show the tip text at the pointer, keeping it inside the viewport; measured after Vue has rendered the new text. */
async function show(event: MouseEvent, tipText: string): Promise<void> {
  text.value = tipText;
  isHidden.value = false;
  await nextTick();
  const width = tooltip.value?.offsetWidth ?? 0;
  leftPx.value = Math.min(event.clientX + POINTER_OFFSET_PX, window.innerWidth - width - VIEWPORT_MARGIN_PX);
  topPx.value = event.clientY + POINTER_OFFSET_PX;
}

function onMouseMove(event: MouseEvent): void {
  const target = event.target instanceof Element ? event.target.closest('[data-tip]') : null;
  const tipText = target?.getAttribute('data-tip') ?? null;
  if (tipText === null) {
    isHidden.value = true;
    return;
  }
  void show(event, tipText);
}

onMounted(() => document.addEventListener('mousemove', onMouseMove));
onUnmounted(() => document.removeEventListener('mousemove', onMouseMove));
</script>

<template>
  <div
    id="tip"
    ref="tooltip"
    class="tip"
    role="tooltip"
    :hidden="isHidden"
    :style="{ left: `${leftPx}px`, top: `${topPx}px` }"
  >{{ text }}</div>
</template>
