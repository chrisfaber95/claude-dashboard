<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watchEffect } from 'vue';
import { useDashboardState } from '../../app/dashboard-state.ts';
import { elementById } from '../../shared/dom.ts';
import { projectTint } from '../../shared/project-colors.ts';
import { openSubagentTranscript, openTranscript } from '../controls/transcript-drawer-selection.ts';
import BuildingScene from './building-scene.vue';
import { setOpenBuilding } from './building-selection.ts';
import { buildingSubtitle } from './building.logic.ts';

const state = useDashboardState();
const openName = ref<string | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);

const project = computed(() => state.value?.projects.find((candidate) => candidate.name === openName.value) ?? null);
const isOpen = computed(() => project.value !== null);

const sessions = computed(() =>
  (state.value?.sessions ?? []).filter((session) => session.project === openName.value).sort((a, b) => a.startedAtMs - b.startedAtMs),
);

const subtitle = computed(() => {
  if (!project.value || !state.value) return '';
  const sessionIds = new Set(sessions.value.map((session) => session.sessionId));
  const subagents = state.value.subagents.filter((subagent) => sessionIds.has(subagent.sessionId));
  return buildingSubtitle(project.value, sessions.value, subagents);
});

// The scene reads the open building from its store; the project colours arrive with the state, so this re-runs per push.
watchEffect(() => {
  const name = project.value?.name;
  // The project vanished from the state: close for good, so it doesn't reopen if the name comes back.
  if (!name && state.value) openName.value = null;
  setOpenBuilding(name ? { name, tintClass: projectTint(name) } : null);
});

function isActivationKey(event: KeyboardEvent): boolean {
  return event.key === 'Enter' || event.key === ' ';
}

function asElement(target: EventTarget | null): Element | null {
  return target instanceof Element ? target : null;
}

function close(): void {
  const name = openName.value;
  openName.value = null;
  // Hand keyboard focus back to the card that opened the building.
  if (name) document.querySelector<HTMLElement>(`[data-building="${CSS.escape(name)}"]`)?.focus();
}

async function open(name: string): Promise<void> {
  openName.value = name;
  await nextTick();
  closeButton.value?.focus();
}

/** A click or Enter on a room opens the session's transcript; on a cubicle, the subagent's. */
function activate(target: Element): boolean {
  const cubicle = target.closest<SVGElement>('[data-sub]');
  const subagentId = cubicle?.dataset.sub;
  if (cubicle && subagentId) {
    openSubagentTranscript(subagentId, cubicle.dataset.name ?? subagentId);
    return true;
  }
  const room = target.closest<SVGElement>('[data-room]');
  const sessionId = room?.dataset.room;
  if (room && sessionId) {
    openTranscript(sessionId, room.dataset.name ?? sessionId);
    return true;
  }
  return false;
}

function onDialogClick(event: MouseEvent): void {
  const target = asElement(event.target);
  if (!target) return;
  if (event.target === event.currentTarget) close();
  else activate(target);
}

function onDialogKeydown(event: KeyboardEvent): void {
  if (!isActivationKey(event)) return;
  const target = asElement(event.target);
  if (target && activate(target)) event.preventDefault();
}

/** The project card an event came from, if its target is inside one. */
function buildingCardOf(target: EventTarget | null): HTMLElement | null {
  return asElement(target)?.closest<HTMLElement>('[data-building]') ?? null;
}

function onDocumentClick(event: MouseEvent): void {
  const name = buildingCardOf(event.target)?.dataset.building;
  if (name) void open(name);
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (!isActivationKey(event)) return;
  const card = buildingCardOf(event.target);
  if (!card || card !== event.target) return;
  event.preventDefault();
  if (card.dataset.building) void open(card.dataset.building);
}

// Capture phase: runs before the transcript drawer's handler, so Escape closes the drawer first and the building second.
function onEscape(event: KeyboardEvent): void {
  if (event.key === 'Escape' && isOpen.value && elementById('drawer').hidden) close();
}

onMounted(() => {
  document.addEventListener('keydown', onEscape, true);
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onDocumentKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onEscape, true);
  document.removeEventListener('click', onDocumentClick);
  document.removeEventListener('keydown', onDocumentKeydown);
});
</script>

<template>
  <div
    id="building"
    class="building"
    role="dialog"
    aria-modal="true"
    aria-labelledby="building-title"
    :hidden="!isOpen"
    @click="onDialogClick"
    @keydown="onDialogKeydown"
  >
    <div class="building__panel">
      <div class="building__head">
        <div>
          <h2 id="building-title">{{ project?.name }}</h2>
          <div id="building-sub" class="sub">{{ subtitle }}</div>
        </div>
        <button id="building-close" ref="closeButton" class="btn" type="button" aria-label="Close building" @click.stop="close">Close</button>
      </div>
      <div id="building-body" class="building__scene"><BuildingScene /></div>
      <p class="sub building__hint">Each room is one live session; the small desks below a room are its subagents, joined by pipes to whoever handed them the work. Click a room or a desk to read its transcript.</p>
    </div>
  </div>
</template>
