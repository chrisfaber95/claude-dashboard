<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useDashboardState } from '../../app/dashboard-state.ts';
import ChatPanel from '../chat/chat-panel.vue';
import AuditPanel from '../audit/audit-panel.vue';
import RunPanel from '../controls/run-panel.vue';
import DevicesPanel from '../devices/devices-panel.vue';
import MessagesPanel from '../messages/messages-panel.vue';
import ApprovalsPanel from '../permissions/approvals-panel.vue';
import ProjectsPanel from '../projects/projects-panel.vue';
import SummarySetting from '../settings/summary-setting.vue';
import TeamPanel from '../team/team-panel.vue';
import UsagePanel from '../usage/usage-panel.vue';
import { setOpenPopup, useOpenPopup } from './open-popup.ts';
import { POPUPS, backdropCloses, escapeClosesPopup, popupFrameClass, popupSectionClass, stillOpen, toggled, visiblePopups } from './popups.logic.ts';
import type { PopupId } from './popups.logic.ts';

// The panels stay mounted while their popup is shut, so each keeps its typed input, focus and selection.

const state = useDashboardState();
const openId = useOpenPopup();
const closeButtons = new Map<PopupId, HTMLButtonElement>();
let opener: HTMLElement | null = null;

const visibleIds = computed(() =>
  visiblePopups({
    hasTeamBoard: Boolean(state.value?.team),
    canRunCommands: state.value?.features.commands === true,
    canManageDevices: state.value?.features.manageDevices === true,
  }),
);
const buttons = computed(() => POPUPS.filter((popup) => visibleIds.value.includes(popup.id)));

function registerCloseButton(id: PopupId, element: unknown): void {
  if (element instanceof HTMLButtonElement) closeButtons.set(id, element);
  else closeButtons.delete(id);
}

function close(): void {
  if (openId.value === null) return;
  setOpenPopup(null);
  // Hand keyboard focus back to the button that opened it, unless the state hid that button meanwhile.
  if (opener && !opener.hidden) opener.focus();
  opener = null;
}

async function onBarClick(id: PopupId, event: MouseEvent): Promise<void> {
  const next = toggled(openId.value, id);
  if (next === null) {
    close();
    return;
  }
  opener = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  setOpenPopup(next);
  await nextTick();
  closeButtons.get(next)?.focus();
}

function onBackdropClick(event: MouseEvent): void {
  if (backdropCloses(event.target, event.currentTarget)) close();
}

// Capture phase and registered before the building dialog and drawer: they are still open when this runs,
// so Esc closes them first and the popup only on the next press.
function onEscape(event: KeyboardEvent): void {
  const isAboveOpen = ['building', 'drawer'].some((id) => document.getElementById(id)?.hidden === false);
  if (escapeClosesPopup(event.key, openId.value, isAboveOpen)) close();
}

// A popup whose button went away (board removed, devices no longer allowed) closes by itself.
watch(visibleIds, (ids) => {
  if (openId.value !== null && stillOpen(openId.value, ids) === null) close();
});
onMounted(() => document.addEventListener('keydown', onEscape, true));
onBeforeUnmount(() => document.removeEventListener('keydown', onEscape, true));

const panels = {
  projects: ProjectsPanel,
  comms: MessagesPanel,
  team: TeamPanel,
  usage: UsagePanel,
  chat: ChatPanel,
  run: RunPanel,
  devices: DevicesPanel,
  audit: AuditPanel,
  approvals: ApprovalsPanel,
} satisfies Record<PopupId, object>;
</script>

<template>
  <button
    v-for="popup in POPUPS"
    :key="popup.id"
    type="button"
    class="btn"
    :data-popup="popup.id"
    aria-haspopup="dialog"
    :aria-expanded="openId === popup.id"
    :hidden="!buttons.includes(popup)"
    @click="onBarClick(popup.id, $event)"
  >
    {{ popup.label }}
  </button>
  <Teleport to="body">
    <div class="popups" :hidden="openId === null" @click="onBackdropClick">
      <div
        v-for="popup in POPUPS"
        :key="popup.id"
        :id="`popup-${popup.id}`"
        :class="popupFrameClass(popup.id)"
        role="dialog"
        aria-modal="true"
        :aria-label="popup.label"
        :hidden="openId !== popup.id"
      >
        <button
          :ref="(element) => registerCloseButton(popup.id, element)"
          class="btn popup__close"
          type="button"
          :aria-label="`Close ${popup.label}`"
          @click="close"
        >
          Close
        </button>
        <section :id="popup.id" :class="popupSectionClass(popup.id)" :aria-labelledby="`h-${popup.id}`">
          <template v-if="popup.id === 'chat'">
            <ChatPanel />
            <div class="chat__setting"><SummarySetting /></div>
          </template>
          <component :is="panels[popup.id]" v-else />
        </section>
      </div>
    </div>
  </Teleport>
</template>
