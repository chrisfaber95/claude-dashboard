<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useDashboardState } from '../../app/dashboard-state.ts';
import { api, ApiError } from '../../shared/api.ts';
import { answerErrorMessage, canAnswer, pendingRequests, PC_HINT, sessionLabel } from './permissions.logic.ts';
import type { AnswerProgress } from './permissions.logic.ts';

/** Where the requests are listed: the sessions section or the needs-you list. */
const props = defineProps<{ context: 'sessions' | 'alerts' }>();

const state = useDashboardState();
const progressById = ref(new Map<string, AnswerProgress>());

const items = computed(() => {
  const current = state.value;
  if (!current) return [];
  const isAnswerable = canAnswer(current.features);
  return pendingRequests(current).map((request) => ({
    request,
    label: sessionLabel(request.sessionId, current.sessions),
    isAnswerable,
    progress: progressById.value.get(request.id),
  }));
});

// A request that is no longer pending was answered or expired: forget its progress.
watch(items, (shown) => {
  const pendingIds = new Set(shown.map((item) => item.request.id));
  for (const id of progressById.value.keys()) if (!pendingIds.has(id)) progressById.value.delete(id);
});

async function decide(requestId: string, decision: 'allow' | 'deny'): Promise<void> {
  progressById.value.set(requestId, { isBusy: true, message: '' });
  try {
    await api(`/api/permissions/${encodeURIComponent(requestId)}`, { decision });
    // Stays busy: the request leaves the list when a state push no longer shows it as pending.
  } catch (error) {
    const message = answerErrorMessage(error instanceof ApiError ? error.message : null);
    progressById.value.set(requestId, { isBusy: false, message });
  }
}
</script>

<template>
  <li v-for="item in items" :key="`permission-${props.context}-${item.request.id}`" class="permission">
    <div class="permission__head">
      <strong class="permission__tool">{{ item.request.tool }}</strong> <span class="sub">{{ item.label }}</span>
    </div>
    <div class="permission__text">{{ item.request.text }}</div>
    <div class="permission__actions">
      <template v-if="item.isAnswerable">
        <button class="btn btn--sm" type="button" data-permission-decide="allow" :disabled="item.progress?.isBusy === true" @click="decide(item.request.id, 'allow')">Approve</button>
        <button class="btn btn--sm" type="button" data-permission-decide="deny" :disabled="item.progress?.isBusy === true" @click="decide(item.request.id, 'deny')">Deny</button>
      </template>
      <span v-else class="sub permission__hint">{{ PC_HINT }}</span>
      <span class="sub permission__status" role="status">{{ item.progress?.message ?? '' }}</span>
    </div>
  </li>
</template>
