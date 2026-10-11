<script setup lang="ts">
import { computed } from 'vue';
import { useDashboardState } from '../../app/dashboard-state.ts';
import RelativeTime from '../../shared/relative-time.vue';
import { formatTokenCount, sumTokens } from '../../shared/token-format.ts';
import PermissionRequests from '../permissions/permission-requests.vue';
import { pendingRequests } from '../permissions/permissions.logic.ts';
import { stopSession } from '../controls/session-actions.ts';
import { openLogs, openTranscript } from '../controls/transcript-drawer-selection.ts';
import { dotStateClass, isBackgroundSession } from './sessions.logic.ts';

const RECENT_SESSIONS_SHOWN = 12;
const SHORT_ID_LENGTH = 8;

const state = useDashboardState();

const canControl = computed(() => state.value?.features.commands === true);
const hasRequests = computed(() => (state.value ? pendingRequests(state.value).length > 0 : false));

const rows = computed(() =>
  (state.value?.sessions ?? []).map((session) => {
    const { tokens } = session;
    return {
      session,
      dotClass: dotStateClass(session.status),
      isBackground: isBackgroundSession(session),
      tokenText: formatTokenCount(sumTokens(tokens)),
      tokenTooltip: `in ${formatTokenCount(tokens.input)} · out ${formatTokenCount(tokens.output)}\ncache read ${formatTokenCount(tokens.cacheRead)} · write ${formatTokenCount(tokens.cacheWrite)}`,
    };
  }),
);

const recentSessions = computed(() =>
  (state.value?.recentSessions ?? [])
    .filter((recent) => !recent.live)
    .slice(0, RECENT_SESSIONS_SHOWN)
    .map((recent) => ({ recent, label: `${recent.project} · ${recent.sessionId.slice(0, SHORT_ID_LENGTH)}` })),
);
</script>

<template>
  <h2 id="h-sessions">Live sessions</h2>
  <template v-if="hasRequests">
    <h3 class="h3">Permission requests</h3>
    <ul class="permissions">
      <PermissionRequests context="sessions" />
    </ul>
  </template>
  <div v-if="rows.length" class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Session</th>
          <th>Project</th>
          <th>Status</th>
          <th>Branch</th>
          <th>Source</th>
          <th>Up</th>
          <th class="num">Tokens</th>
          <th><span class="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.session.sessionId" :data-key="row.session.sessionId">
          <td>
            <span :class="['dot', row.dotClass]"></span>{{ row.session.name }}<template v-if="row.isBackground"> <span class="badge">background</span></template>
          </td>
          <td>{{ row.session.project }}</td>
          <td>{{ row.session.status }}</td>
          <td>{{ row.session.branch ? row.session.branch : '—' }}</td>
          <td>{{ row.session.entrypoint || row.session.kind }}</td>
          <td><RelativeTime kind="up" :timestamp-ms="row.session.startedAtMs" /></td>
          <td class="num" :data-tip="row.tokenTooltip">{{ row.tokenText }}</td>
          <td class="actions">
            <button class="btn btn--sm" @click="openTranscript(row.session.sessionId, row.session.name)">View</button>
            <template v-if="canControl && row.isBackground">
              {{ ' ' }}<button class="btn btn--sm" @click="openLogs(row.session.sessionId, row.session.name)">Logs</button>
              {{ ' ' }}<button class="btn btn--sm" @click="stopSession(row.session.sessionId, row.session.name)">Stop</button>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
  <div v-else class="empty">No live sessions.</div>
  <template v-if="recentSessions.length">
    <h3 class="h3">Recent sessions</h3>
    <ul class="recent">
      <li v-for="item in recentSessions" :key="item.recent.sessionId" :data-key="item.recent.sessionId">
        <button class="link" @click="openTranscript(item.recent.sessionId, item.label)">{{ item.label }}</button>
        <span class="sub"><RelativeTime kind="ago" :timestamp-ms="item.recent.lastTsMs" /></span>
      </li>
    </ul>
  </template>
</template>
