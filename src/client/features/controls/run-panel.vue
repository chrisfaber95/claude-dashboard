<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watchEffect } from 'vue';
import type { AuditEntry, CommandResult } from '../../../shared/types/index.ts';
import { useDashboardState } from '../../app/dashboard-state.ts';
import { api } from '../../shared/api.ts';
import RelativeTime from '../../shared/relative-time.vue';
import { fieldsAfterLaunch, launchBody, launchRow, launchState } from '../launch/launch.logic.ts';
import { describeCommandResult, matchSession } from './controls.logic.ts';

const DEFAULT_PERMISSION_MODE = 'auto';

const state = useDashboardState();

const projects = computed(() => state.value?.projects ?? []);
const permissionModes = computed<string[]>(() => [...(state.value?.features.permissionModes ?? [])]);

const chosenProject = ref('');
const chosenMode = ref('');
const goal = ref('');
const notes = ref('');
const statusText = ref('');
// Server-side history from GET /api/launches, the same on every device.
const launches = ref<AuditEntry[]>([]);

// Keep the choice across state pushes; fall back to a default only when the choice is gone from the list.
watchEffect(() => {
  if (!projects.value.some((project) => project.name === chosenProject.value)) chosenProject.value = projects.value[0]?.name ?? '';
  if (!permissionModes.value.includes(chosenMode.value)) {
    chosenMode.value = permissionModes.value.includes(DEFAULT_PERMISSION_MODE) ? DEFAULT_PERMISSION_MODE : (permissionModes.value[0] ?? '');
  }
});

const launchItems = computed(() =>
  launches.value.map(launchRow).map((row) => {
    const isRunning = Boolean(row.session && state.value && matchSession(state.value.sessions, row.session));
    const rowState = launchState(row, isRunning);
    return { ...row, state: rowState, itemClass: { 'is-live': rowState === 'running', 'is-failed': rowState === 'failed' } };
  }),
);

/** Fetch the launch history; on failure the list we have stays and the next load retries. */
async function loadLaunches(): Promise<void> {
  try {
    launches.value = (await api<{ launches: AuditEntry[] }>('/api/launches')).launches;
  } catch {
    // keep the list we have
  }
}

function failureText(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed.';
}

async function submit(): Promise<void> {
  const body = launchBody(chosenProject.value, goal.value, notes.value, chosenMode.value);
  // Empty goal or no project: skip the confirm, the server answers with its own message, shown below; nothing starts.
  if (body.goal && body.project && !confirm(`Launch a background Claude session in ${body.project} (${body.permissionMode} mode)?`)) return;
  statusText.value = 'Starting…';
  let isStarted = false;
  try {
    const result = await api<CommandResult>('/api/commands', body);
    isStarted = result.ok;
    statusText.value = describeCommandResult(result);
  } catch (error) {
    statusText.value = failureText(error);
  }
  const clear = fieldsAfterLaunch(isStarted);
  if (clear.clearGoal) goal.value = '';
  if (clear.clearNotes) notes.value = '';
  if (isStarted) await loadLaunches();
}

function reloadOnPopupOpen(event: MouseEvent): void {
  if (event.target instanceof Element && event.target.closest('[data-popup="run"]')) void loadLaunches();
}

onMounted(() => {
  void loadLaunches();
  document.addEventListener('click', reloadOnPopupOpen);
});
onBeforeUnmount(() => document.removeEventListener('click', reloadOnPopupOpen));
</script>

<template>
  <h2 id="h-run">Launch a task</h2>
  <form id="run-form" class="run" @submit.prevent="submit">
    <div class="run__row">
      <label>Project
        <select id="run-project" v-model="chosenProject">
          <option v-for="project in projects" :key="project.name" :value="project.name">
            {{ project.name }}{{ project.trusted ? '' : ' (not trusted yet)' }}
          </option>
        </select>
      </label>
      <label>Permissions
        <select id="run-mode" v-model="chosenMode">
          <option v-for="mode in permissionModes" :key="mode" :value="mode">{{ mode }}</option>
        </select>
      </label>
    </div>
    <label class="run__prompt">Goal
      <textarea id="run-goal" v-model="goal" rows="3" maxlength="20000" placeholder="What should Claude achieve?"></textarea>
    </label>
    <label class="run__notes">Background notes (optional)
      <textarea id="run-notes" v-model="notes" rows="3" maxlength="20000" placeholder="Context, constraints, files to look at"></textarea>
    </label>
    <div class="run__row">
      <button class="btn btn--primary" type="submit">Launch task</button>
      <span id="run-status" class="sub" role="status">{{ statusText }}</span>
    </div>
  </form>
  <div id="recent" class="recent" :hidden="launchItems.length === 0">
    <div class="recent__head">
      <h3 id="h-recent">Recent launches</h3>
    </div>
    <ul id="recent-list" class="recent__list" aria-labelledby="h-recent">
      <li v-for="item in launchItems" :key="item.key" :class="['recent__item', item.itemClass]" :data-key="item.key">
        <span class="recent__dot" aria-hidden="true"></span>
        <span class="recent__main">
          <span class="recent__project">{{ item.project }}</span>
          <span class="recent__prompt">{{ item.goal }}</span>
          <span class="sub">
            <span class="recent__time"><RelativeTime kind="ago" :timestamp-ms="item.tsMs" /></span>
            · {{ item.device }} · <span class="recent__state">{{ item.state }}</span>
          </span>
        </span>
        <button v-if="item.session" class="btn btn--sm" type="button" :data-recent="item.session" :data-name="item.project">View</button>
      </li>
    </ul>
  </div>
</template>
