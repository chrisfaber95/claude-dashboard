<script setup lang="ts">
import { computed } from 'vue';
import type { SubagentInfo } from '../../../shared/types/index.ts';
import { CUBICLE_HEIGHT, CUBICLE_WIDTH, agentTypeHue, cubicleDotState, cubicleLabel, subagentTooltip, truncateWithEllipsis } from './building.logic.ts';

const props = defineProps<{ subagent: SubagentInfo; subagentsById: Map<string, SubagentInfo>; x: number; y: number }>();

const AGENT_TYPE_LABEL_MAX = 11;
const CODE_LINE_WIDTHS = [8, 11, 6];

const isWorking = computed(() => props.subagent.state === 'working');
const color = computed(() => agentTypeHue(props.subagent.agentType));
const hasTick = computed(() => props.subagent.handedBack && !isWorking.value);
const wallClasses = computed(() => [
  'annex__cube',
  `annex__cube--${props.subagent.state}`,
  { 'annex__cube--child': Boolean(props.subagent.parentAgentId) },
]);
const displayName = computed(() => `${props.subagent.agentType}: ${props.subagent.description || props.subagent.agentId}`);
const ariaLabel = computed(() => `${props.subagent.agentType}, ${props.subagent.state}. Open what it did`);
</script>

<template>
  <!-- One subagent at its desk: a small robot that types while it works and shows a tick once it has handed back. -->
  <g
    :class="wallClasses"
    :transform="`translate(${x} ${y})`"
    :data-tip="subagentTooltip(subagent, subagentsById)"
    :data-sub="subagent.agentId"
    :data-name="displayName"
    tabindex="0"
    role="button"
    :aria-label="ariaLabel"
  >
    <rect class="annex__wall" :width="CUBICLE_WIDTH" :height="CUBICLE_HEIGHT" rx="4" />
    <text class="annex__type" x="4" y="10">{{ truncateWithEllipsis(subagent.agentType, AGENT_TYPE_LABEL_MAX) }}</text>
    <circle :class="`annex__dot annex__dot--${cubicleDotState(subagent)}`" :cx="CUBICLE_WIDTH - 6" cy="7" r="4" />
    <path v-if="hasTick" class="annex__tick" :d="`M${CUBICLE_WIDTH - 8.6} 7l1.9 1.9 3.4-3.8`" />
    <rect class="annex__desk" x="22" y="46" width="40" height="4" rx="1" />
    <rect class="annex__desk" x="25" y="50" width="3" height="8" />
    <rect class="annex__desk" x="56" y="50" width="3" height="8" />
    <rect class="room__monitor" x="36" y="26" width="22" height="16" rx="2" />
    <rect :class="['room__screen', { 'room__screen--off': !isWorking }]" x="38" y="28" width="18" height="12" rx="1" />
    <rect class="annex__desk" x="45" y="42" width="4" height="4" />
    <template v-if="isWorking">
      <rect
        v-for="(width, line) in CODE_LINE_WIDTHS"
        :key="line"
        :class="`room__code room__code--${line}`"
        x="40"
        :y="30 + line * 3.5"
        :width="width"
        height="1.4"
        rx="0.7"
      />
    </template>
    <line class="annex__antenna" x1="17" y1="16" x2="17" y2="19" />
    <circle :class="`shirt-${color}`" cx="17" cy="15" r="2" />
    <rect class="annex__head" x="11" y="19" width="12" height="11" rx="3" />
    <circle class="annex__eye" cx="15" cy="24" r="1.3" />
    <circle class="annex__eye" cx="20" cy="24" r="1.3" />
    <rect :class="`shirt-${color}`" x="10" y="31" width="14" height="15" rx="3" />
    <rect :class="`annex__arm shirt-${color}`" x="22" y="39" width="15" height="3.2" rx="1.6" />
    <text class="annex__activity" x="4" :y="CUBICLE_HEIGHT - 4" :data-act="subagent.agentId">{{ cubicleLabel(subagent) }}</text>
  </g>
</template>
