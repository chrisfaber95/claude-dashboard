<script setup lang="ts">
import { computed } from 'vue';
import type { SubagentInfo } from '../../../shared/types/index.ts';
import BuildingCubicle from './building-cubicle.vue';
import { annexLayout } from './building-layout.logic.ts';

const props = defineProps<{ subagents: SubagentInfo[]; subagentsById: Map<string, SubagentInfo>; x: number; y: number }>();

const layout = computed(() => annexLayout(props.subagents));
</script>

<template>
  <!-- The subagents of one session, under its room: pipes from whoever handed them the work, mail in transit, one cubicle each. -->
  <g class="annex" :transform="`translate(${x} ${y})`">
    <path v-for="path in layout.pipePaths" :key="path" class="annex__pipe" :d="path" />
    <path v-for="path in layout.nestedPipePaths" :key="path" class="annex__pipe annex__pipe--nested" :d="path" />
    <g v-for="mail in layout.mail" :key="mail.agentId" :transform="`translate(${mail.x} ${mail.y})`">
      <g :class="`annex__mail annex__mail--c${mail.column}`">
        <rect x="-4" y="-3" width="8" height="6" rx="1" />
        <path d="M-4 -3l4 3 4-3" />
      </g>
    </g>
    <BuildingCubicle
      v-for="cubicle in layout.cubicles"
      :key="cubicle.subagent.agentId"
      :subagent="cubicle.subagent"
      :subagents-by-id="subagentsById"
      :x="cubicle.x"
      :y="cubicle.y"
    />
  </g>
</template>
