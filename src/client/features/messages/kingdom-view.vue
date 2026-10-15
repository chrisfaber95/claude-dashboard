<script setup lang="ts">
import { computed } from 'vue';
import { buildKingdomScene } from './kingdom-scene.logic.ts';
import type { KingdomLayout } from './kingdom-layout-types.logic.ts';
import type { Kingdom } from './kingdom-types.logic.ts';

const props = defineProps<{ kingdom: Kingdom; layout: KingdomLayout }>();

const scene = computed(() => buildKingdomScene(props.kingdom, props.layout));
</script>

<template>
  <svg
    :class="['iso', 'kingdom', `kingdom--${scene.orientation}`]"
    :viewBox="scene.viewBox"
    role="img"
    aria-label="Sessions as buildings in a kingdom, messages as mailmen"
  >
    <g class="kingdom__ground">
      <path class="kingdom__grass" :d="scene.backdrop" />
      <path v-for="(tile, index) in scene.ground" :key="index" :class="tile.className" :d="tile.d" />
    </g>
    <g class="kingdom__scene">
      <TransitionGroup name="kingdom-item" tag="g">
        <g v-for="item in scene.items" :key="item.key" :class="item.className" :style="item.vars" :data-key="item.key">
          <path v-for="(part, index) in item.parts" :key="index" :class="part.className" :d="part.d" :data-tip="part.tip" />
        </g>
      </TransitionGroup>
    </g>
    <g class="kingdom__labels">
      <text v-for="label in scene.labels" :key="label.key" :class="label.className" :x="label.x" :y="label.y" :data-tip="label.tip">
        {{ label.text }}
      </text>
    </g>
  </svg>
</template>
