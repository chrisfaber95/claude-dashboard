<script setup lang="ts">
import { ROOM_HEIGHT, ROOM_WIDTH } from './building.logic.ts';

defineProps<{ x: number; y: number }>();

const TEXT_MARGIN = 10;
</script>

<template>
  <!-- The dark room shown when the project has no live session. -->
  <g class="room room--empty" :transform="`translate(${x} ${y})`">
    <rect class="room__wall" :width="ROOM_WIDTH" :height="ROOM_HEIGHT" rx="4" />
    <rect class="room__floor" y="112" :width="ROOM_WIDTH" height="18" />
    <rect class="room__window" x="14" y="16" width="40" height="34" rx="2" />
    <rect class="room__desk" x="70" y="87" width="104" height="6" rx="2" />
    <rect class="room__desk" x="76" y="93" width="4" height="19" />
    <rect class="room__desk" x="164" y="93" width="4" height="19" />
    <rect class="room__monitor" x="112" y="58" width="46" height="30" rx="3" />
    <rect class="room__screen room__screen--off" x="115" y="61" width="40" height="24" rx="1.5" />
    <text class="room__name" :x="TEXT_MARGIN" y="13">Nobody here</text>
    <text class="room__state" :x="ROOM_WIDTH - TEXT_MARGIN" y="13" text-anchor="end">lights off</text>
  </g>
</template>
