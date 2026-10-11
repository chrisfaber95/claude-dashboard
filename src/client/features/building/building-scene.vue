<script setup lang="ts">
import { computed } from 'vue';
import { useDashboardState } from '../../app/dashboard-state.ts';
import BuildingAnnex from './building-annex.vue';
import BuildingEmptyRoom from './building-empty-room.vue';
import BuildingRoom from './building-room.vue';
import { sceneGeometry } from './building-layout.logic.ts';
import { BASE_HEIGHT, BUILDING_PADDING, ROOF_HEIGHT, ROOM_GAP, buildingAriaLabel, truncateWithEllipsis } from './building.logic.ts';
import { useOpenBuilding } from './building-selection.ts';

const TITLE_MAX = 26;
const SIGN_TOP = 22;
const SIGN_HEIGHT = ROOF_HEIGHT - SIGN_TOP;
const DOOR_WIDTH = 32;
const DOOR_OFFSET = 16;
const KNOB_OFFSET = 25;

const state = useDashboardState();
const openBuilding = useOpenBuilding();

const sessions = computed(() => {
  const open = openBuilding.value;
  if (!open || !state.value) return [];
  return state.value.sessions.filter((session) => session.project === open.name).sort((a, b) => a.startedAtMs - b.startedAtMs);
});

const subagents = computed(() => {
  const sessionIds = new Set(sessions.value.map((session) => session.sessionId));
  return (state.value?.subagents ?? []).filter((subagent) => sessionIds.has(subagent.sessionId));
});

const subagentsById = computed(() => new Map(subagents.value.map((subagent) => [subagent.agentId, subagent])));

const geometry = computed(() => sceneGeometry(sessions.value, subagents.value));
const centerX = computed(() => geometry.value.width / 2);
const baseTop = computed(() => geometry.value.roomsBottom + ROOM_GAP);
const bodyHeight = computed(() => geometry.value.roomsBottom - ROOF_HEIGHT + ROOM_GAP + 4);
const doorX = computed(() => centerX.value - DOOR_OFFSET);
const signWidth = computed(() => geometry.value.width - BUILDING_PADDING * 2);

const title = computed(() => truncateWithEllipsis(openBuilding.value?.name ?? '', TITLE_MAX));
const ariaLabel = computed(() => buildingAriaLabel(openBuilding.value?.name ?? '', sessions.value.length, subagents.value.length));
</script>

<template>
  <!-- The whole building as one SVG: sign, one room per session with its annex, base and door. -->
  <svg
    v-if="openBuilding"
    :class="['building__svg', `building__svg--cols-${geometry.columns}`]"
    :viewBox="`0 0 ${geometry.width} ${geometry.height}`"
    role="group"
    :aria-label="ariaLabel"
  >
    <g class="building__clouds">
      <ellipse class="cloud" cx="40" cy="30" rx="26" ry="9" />
      <ellipse class="cloud cloud--b" :cx="geometry.width - 60" cy="52" rx="32" ry="10" />
    </g>
    <rect class="building__antenna" :x="centerX - 1.5" y="2" width="3" height="22" />
    <circle class="building__beacon" :cx="centerX" cy="3" r="3.5" />
    <rect :class="['building__sign', openBuilding.tintClass]" :x="BUILDING_PADDING" :y="SIGN_TOP" :width="signWidth" :height="SIGN_HEIGHT" rx="6" />
    <text class="building__title" :x="centerX" :y="SIGN_TOP + SIGN_HEIGHT / 2 + 6" text-anchor="middle">{{ title }}</text>
    <rect class="building__body" x="2" :y="ROOF_HEIGHT - 2" :width="geometry.width - 4" :height="bodyHeight" rx="3" />
    <template v-for="slot in geometry.slots" :key="slot.session ? slot.session.sessionId : 'empty'">
      <BuildingRoom v-if="slot.session" :session="slot.session" :index="slot.index" :x="slot.x" :y="slot.y" />
      <BuildingEmptyRoom v-else :x="slot.x" :y="slot.y" />
      <BuildingAnnex v-if="slot.subagents.length" :subagents="slot.subagents" :subagents-by-id="subagentsById" :x="slot.x" :y="slot.y" />
    </template>
    <rect class="building__base" x="0" :y="baseTop" :width="geometry.width" :height="BASE_HEIGHT" />
    <rect class="building__door" :x="doorX" :y="baseTop + 4" :width="DOOR_WIDTH" :height="BASE_HEIGHT - 4" rx="3" />
    <circle class="building__knob" :cx="doorX + KNOB_OFFSET" :cy="baseTop + 18" r="1.8" />
  </svg>
</template>
