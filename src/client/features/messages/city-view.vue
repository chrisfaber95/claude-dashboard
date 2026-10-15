<script setup lang="ts">
import { computed } from 'vue';
import type { City } from './city.logic.ts';
import {
  AWNING_HEIGHT,
  BODY_HEIGHT,
  CITY_WIDTH,
  SHOP_WIDTH,
  bossPoint,
  cityHeight,
  doorPoint,
  postmanPath,
  shopNameLabel,
  shopOrigin,
  shopStatusLabel,
  workerPoint,
} from './city-layout.logic.ts';

const SHOP_COLOR_SLOTS = 8;
const DOOR_WIDTH = 16;
const DOOR_HEIGHT = 22;
const AWNING_SLANT = 8;

const props = defineProps<{ city: City }>();

const viewBox = computed(() => `0 0 ${CITY_WIDTH} ${cityHeight(props.city.shops)}`);

const shops = computed(() =>
  props.city.shops.map((shop) => {
    const origin = shopOrigin(shop);
    const bodyTop = origin.y + AWNING_HEIGHT;
    const right = origin.x + SHOP_WIDTH;
    return {
      shop,
      origin,
      bodyTop,
      door: doorPoint(shop),
      boss: bossPoint(shop),
      awning: `M${origin.x} ${bodyTop}L${origin.x + AWNING_SLANT} ${origin.y}H${right - AWNING_SLANT}L${right} ${bodyTop}Z`,
      color: `var(--s${(shop.slot % SHOP_COLOR_SLOTS) + 1})`,
      name: shopNameLabel(shop.name),
      status: shopStatusLabel(shop),
      workers: shop.workers.map((worker, index) => ({ worker, point: workerPoint(shop, index) })),
      morePoint: workerPoint(shop, shop.workers.length),
    };
  }),
);

const postmen = computed(() =>
  props.city.postmen.flatMap((postman) => {
    const path = postmanPath(postman, props.city.shops);
    if (!path) return [];
    const style = { '--from-x': `${path.from.x}px`, '--from-y': `${path.from.y}px`, '--to-x': `${path.to.x}px`, '--to-y': `${path.to.y}px` };
    return [{ postman, style, tooltip: `${postman.from} → ${postman.to}` }];
  }),
);
</script>

<template>
  <svg class="chart city" :viewBox="viewBox" role="img" aria-label="Sessions as shops, messages as postmen">
    <g v-for="item in shops" :key="item.shop.name" :class="['city__shop', `is-${item.shop.state}`]" :data-key="item.shop.name">
      <rect class="city__body" :x="item.origin.x" :y="item.bodyTop" :width="SHOP_WIDTH" :height="BODY_HEIGHT" rx="3" />
      <path class="city__awning" :d="item.awning" :style="{ fill: item.color }" />
      <rect class="city__door" :x="item.door.x - DOOR_WIDTH / 2" :y="item.door.y - DOOR_HEIGHT" :width="DOOR_WIDTH" :height="DOOR_HEIGHT" />
      <circle class="city__boss" :cx="item.boss.x" :cy="item.boss.y" r="6" :style="{ fill: item.color }" />
      <circle
        v-for="entry in item.workers"
        :key="entry.worker.agentId"
        class="city__worker"
        :cx="entry.point.x"
        :cy="entry.point.y"
        r="4"
        :data-tip="`${entry.worker.agentType}: ${entry.worker.activity}`"
      />
      <text v-if="item.shop.moreWorkers > 0" class="city__more" :x="item.morePoint.x - 4" :y="item.morePoint.y + 4">
        +{{ item.shop.moreWorkers }} more
      </text>
      <text class="node-label" :x="item.origin.x + SHOP_WIDTH / 2" :y="item.bodyTop + BODY_HEIGHT + 14" text-anchor="middle">{{ item.name }}</text>
      <text class="city__status" :x="item.origin.x + SHOP_WIDTH / 2" :y="item.bodyTop + BODY_HEIGHT + 27" text-anchor="middle">{{ item.status }}</text>
    </g>
    <g v-for="item in postmen" :key="item.postman.key" class="city__postman" :style="item.style" :data-tip="item.tooltip">
      <circle r="5" />
      <rect x="-3" y="-2" width="6" height="4" />
    </g>
  </svg>
</template>
