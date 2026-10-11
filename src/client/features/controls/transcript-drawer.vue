<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch, watchEffect } from 'vue';
import type { CommandResult, TranscriptEntry, TranscriptPage } from '../../../shared/types/index.ts';
import { useDashboardState } from '../../app/dashboard-state.ts';
import { api } from '../../shared/api.ts';
import { entrySpeaker, showsTranscript, transcriptPath } from './controls.logic.ts';
import { continueSession } from './session-actions.ts';
import { showToast } from './use-toasts.ts';
import { closeDrawer, useDrawerRequest } from './transcript-drawer-selection.ts';
import type { DrawerRequest } from './transcript-drawer-selection.ts';
import { isLiveElsewhere, mergeLiveTail } from './transcript-drawer.logic.ts';

const POLL_INTERVAL_MS = 2000;
const NEAR_BOTTOM_PX = 40;
const PAGE_SIZE = 100;
const DEFAULT_PERMISSION_MODE = 'auto';

const state = useDashboardState();
const request = useDrawerRequest();

const body = ref<HTMLElement | null>(null);
const entries = shallowRef<TranscriptEntry[]>([]);
const hasMore = ref(false);
const isTruncated = ref(false);
const isLoading = ref(true);
const loadError = ref('');
const logsOutput = ref('');
const prompt = ref('');
const chosenMode = ref('');
const statusText = ref('');
let pollTimer: number | undefined;

const isOpen = computed(() => request.value !== null);
const isLogs = computed(() => request.value?.mode.kind === 'logs');
const isSubagent = computed(() => request.value?.mode.kind === 'subagent');
const permissionModes = computed<string[]>(() => [...(state.value?.features.permissionModes ?? [])]);
const canRunCommands = computed(() => state.value?.features.commands ?? false);

// The follow-up form is for a session's own transcript; a session live in a terminal or editor gets a note instead.
const sessionId = computed(() => (request.value?.mode.kind === 'transcript' ? request.value.mode.id : ''));
const hasFollowUp = computed(() => sessionId.value !== '' && canRunCommands.value);
const isElsewhere = computed(() => hasFollowUp.value && isLiveElsewhere(sessionId.value, state.value?.sessions ?? []));

// Keep the choice across state pushes; fall back to a default only when the choice is gone from the list.
watchEffect(() => {
  if (permissionModes.value.includes(chosenMode.value)) return;
  chosenMode.value = permissionModes.value.includes(DEFAULT_PERMISSION_MODE) ? DEFAULT_PERMISSION_MODE : (permissionModes.value[0] ?? '');
});

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed.';
}

function entryMeta(entry: TranscriptEntry): string {
  const speaker = entrySpeaker(entry, isSubagent.value);
  return entry.tsMs ? `${speaker} · ${new Date(entry.tsMs).toLocaleTimeString()}` : speaker;
}

function scrollToBottom(): void {
  if (body.value) body.value.scrollTop = body.value.scrollHeight;
}

function isNearBottom(): boolean {
  const element = body.value;
  return !element || element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX;
}

async function refreshTranscript(current: DrawerRequest, isInitial: boolean): Promise<void> {
  if (!showsTranscript(current.mode)) return;
  const shouldStickToBottom = isInitial || isNearBottom();
  try {
    const page = await api<TranscriptPage>(transcriptPath(current.mode, `limit=${PAGE_SIZE}`));
    if (request.value !== current) return;
    const merged = mergeLiveTail(entries.value, page.entries);
    const hasKeptEarlier = merged.length > page.entries.length;
    const previousLength = entries.value.length;
    entries.value = merged;
    if (!hasKeptEarlier) {
      hasMore.value = page.hasMore;
      isTruncated.value = Boolean(page.truncated);
    }
    isLoading.value = false;
    loadError.value = '';
    if (shouldStickToBottom && (isInitial || merged.length !== previousLength)) {
      await nextTick();
      scrollToBottom();
    }
  } catch (error) {
    if (isInitial && request.value === current) {
      loadError.value = errorText(error);
      isLoading.value = false;
    }
  }
}

async function loadLogs(current: DrawerRequest): Promise<void> {
  try {
    const result = await api<CommandResult>(`/api/sessions/${encodeURIComponent(current.mode.id)}/logs`);
    if (request.value === current) logsOutput.value = result.output || '(no output)';
  } catch (error) {
    if (request.value === current) loadError.value = errorText(error);
  }
  if (request.value === current) isLoading.value = false;
}

/** Fetch the page of entries before the oldest one shown and keep the reader's scroll position. */
async function loadEarlier(): Promise<void> {
  const current = request.value;
  const oldest = entries.value[0];
  if (!current || !showsTranscript(current.mode) || !oldest) return;
  try {
    const page = await api<TranscriptPage>(transcriptPath(current.mode, `limit=${PAGE_SIZE}&before=${encodeURIComponent(oldest.uuid)}`));
    if (request.value !== current) return;
    const element = body.value;
    const distanceFromBottom = element ? element.scrollHeight - element.scrollTop : 0;
    entries.value = [...page.entries, ...entries.value];
    hasMore.value = page.hasMore;
    isTruncated.value = Boolean(page.truncated);
    await nextTick();
    if (element) element.scrollTop = element.scrollHeight - distanceFromBottom;
  } catch (error) {
    showToast(errorText(error), true);
  }
}

function stopPolling(): void {
  window.clearInterval(pollTimer);
  pollTimer = undefined;
}

// A new request resets everything and starts loading; closing stops the poll.
watch(request, (current) => {
  stopPolling();
  entries.value = [];
  hasMore.value = false;
  isTruncated.value = false;
  isLoading.value = true;
  loadError.value = '';
  logsOutput.value = '';
  statusText.value = '';
  if (!current) return;
  if (current.mode.kind === 'logs') {
    void loadLogs(current);
    return;
  }
  void refreshTranscript(current, true);
  pollTimer = window.setInterval(() => void refreshTranscript(current, false), POLL_INTERVAL_MS);
});

async function sendFollowUp(): Promise<void> {
  if (!sessionId.value) return;
  statusText.value = 'Sending…';
  const outcome = await continueSession(sessionId.value, prompt.value, chosenMode.value);
  statusText.value = outcome.text;
  if (outcome.isOk) prompt.value = '';
}

function onEscape(event: KeyboardEvent): void {
  if (event.key === 'Escape' && isOpen.value) closeDrawer();
}

onMounted(() => document.addEventListener('keydown', onEscape));

onBeforeUnmount(() => {
  stopPolling();
  document.removeEventListener('keydown', onEscape);
});
</script>

<template>
  <aside id="drawer" class="drawer" aria-labelledby="drawer-title" :hidden="!isOpen">
    <div class="drawer__head">
      <div>
        <h2 id="drawer-title">{{ request?.title }}</h2>
        <div id="drawer-sub" class="sub">{{ request?.subtitle }}</div>
      </div>
      <button id="drawer-close" class="btn" type="button" aria-label="Close transcript" @click="closeDrawer">Close</button>
    </div>
    <div id="drawer-body" ref="body" class="drawer__body">
      <div v-if="isLoading" class="empty">Loading…</div>
      <div v-else-if="loadError" class="empty">{{ loadError }}</div>
      <pre v-else-if="isLogs" class="logs">{{ logsOutput }}</pre>
      <template v-else>
        <button v-if="hasMore" class="btn btn--sm" data-more type="button" @click="loadEarlier">Load earlier</button>
        <div v-else-if="isTruncated" class="sub">Older history isn't shown (very large transcript).</div>
        <div v-if="!entries.length" class="empty">No messages yet.</div>
        <div v-for="entry in entries" :key="entry.uuid" :class="['msg', `msg--${entry.role}`, { 'msg--error': entry.isError }]">
          <div class="msg__meta">{{ entryMeta(entry) }}</div>
          <div class="msg__text">{{ entry.text }}</div>
        </div>
      </template>
    </div>
    <p id="drawer-live-note" class="sub drawer__note" role="note" :hidden="!isElsewhere">
      Open in a terminal or editor; send it there, or continue here after it ends.
    </p>
    <form id="drawer-form" class="drawer__form" :hidden="!hasFollowUp || isElsewhere" @submit.prevent="sendFollowUp">
      <textarea id="drawer-prompt" v-model="prompt" rows="2" maxlength="20000" required placeholder="Send a follow-up (runs as a background continuation)"></textarea>
      <div class="run__row">
        <select id="drawer-mode" v-model="chosenMode" aria-label="Permission mode">
          <option v-for="mode in permissionModes" :key="mode" :value="mode">{{ mode }}</option>
        </select>
        <button class="btn btn--primary" type="submit">Send</button>
        <span id="drawer-status" class="sub" role="status">{{ statusText }}</span>
      </div>
    </form>
  </aside>
</template>
