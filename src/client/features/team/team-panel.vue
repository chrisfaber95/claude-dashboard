<script setup lang="ts">
import { computed } from 'vue';
import { TEAM_COLUMNS } from '../../../shared/types/index.ts';
import { useDashboardState } from '../../app/dashboard-state.ts';
import { useOpenPopup } from '../popups/open-popup.ts';

const state = useDashboardState();
const openPopup = useOpenPopup();

// Derived only while the Team popup is open; with no board in the state nothing renders and the popup button hides.
const board = computed(() => {
  const team = state.value?.team;
  if (openPopup.value !== 'team' || !team) return null;
  const lists = [
    { title: 'In progress', tickets: team.active.inProgress },
    { title: 'Review', tickets: team.active.review },
    { title: 'Blocked', tickets: team.active.blocked },
  ].filter((list) => list.tickets.length > 0);
  const tiles = TEAM_COLUMNS.map((column) => ({ column, count: team.counts[column] ?? 0 }));
  return { tiles, lists, needsYou: team.needsYou };
});
</script>

<template>
  <template v-if="board">
    <h2 id="h-team">Team</h2>
    <div class="team__tiles">
      <div v-for="tile in board.tiles" :key="tile.column" :class="['team__tile', `team__tile--${tile.column}`]">
        <div class="team__count">{{ tile.count }}</div>
        <div class="sub">{{ tile.column }}</div>
      </div>
    </div>
    <template v-for="list in board.lists" :key="list.title">
      <h3 class="h3">{{ list.title }}</h3>
      <ul class="team__list">
        <li v-for="ticket in list.tickets" :key="ticket.id"><span class="team__id">{{ ticket.id }}</span> {{ ticket.title }}</li>
      </ul>
    </template>
    <h3 class="h3">Needs you</h3>
    <ul v-if="board.needsYou.length" class="team__list">
      <li v-for="name in board.needsYou" :key="name">{{ name }}</li>
    </ul>
    <div v-else class="empty">Nothing needs you.</div>
  </template>
</template>
