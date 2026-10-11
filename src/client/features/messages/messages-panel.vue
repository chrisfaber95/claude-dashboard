<script setup lang="ts">
import { computed } from 'vue';
import { useDashboardState } from '../../app/dashboard-state.ts';
import RelativeTime from '../../shared/relative-time.vue';
import { useOpenPopup } from '../popups/open-popup.ts';
import { GRAPH_HEIGHT, GRAPH_WIDTH, buildMessageGraph, edgeTooltip, feedKey, nodeLabel, routeText } from './messages.logic.ts';

const FEED_ENTRIES_SHOWN = 40;
const NODE_COLOR_SLOTS = 8;
const EDGE_WIDTH_MAX = 5;
const DIMMED_NODE_OPACITY = 0.5;

const state = useDashboardState();
const openPopup = useOpenPopup();

// Derived only while the Session messages popup is open; opening it computes from the latest push at once.
const view = computed(() => {
  const current = state.value;
  if (openPopup.value !== 'comms' || !current) return null;
  const sessionMessages = current.messages.filter((message) => message.kind === 'session');
  const subagentCount = current.messages.filter((message) => message.kind === 'subagent').length;
  const sessionNames = current.sessions.map((session) => session.name);
  const liveNames = new Set(sessionNames);
  const graph = buildMessageGraph(sessionNames, sessionMessages);
  const edges = graph.edges.flatMap((edge) => {
    const from = graph.positions.get(edge.from);
    const to = graph.positions.get(edge.to);
    return from && to ? [{ edge, from, to, width: Math.min(1 + edge.count, EDGE_WIDTH_MAX), tooltip: edgeTooltip(edge) }] : [];
  });
  const nodes = graph.nodes.flatMap((name, index) => {
    const point = graph.positions.get(name);
    if (!point) return [];
    const colorSlot = (index % NODE_COLOR_SLOTS) + 1;
    return [{ name, point, label: nodeLabel(name), fill: `var(--s${colorSlot})`, opacity: liveNames.has(name) ? 1 : DIMMED_NODE_OPACITY }];
  });
  return {
    hasGraph: sessionMessages.length > 0,
    edges,
    nodes,
    sessionCount: sessionMessages.length,
    subagentCount,
    feed: current.messages.slice(0, FEED_ENTRIES_SHOWN),
  };
});
</script>

<template>
  <h2 id="h-comms">Session communication</h2>
  <div class="split">
    <div>
      <template v-if="view">
        <svg
          v-if="view.hasGraph"
          class="chart"
          :viewBox="`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`"
          role="img"
          aria-label="Message graph between sessions"
        >
          <defs>
            <marker id="arrow" viewBox="0 0 8 8" refX="14" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0L8 4L0 8z" :style="{ fill: 'var(--muted)' }" />
            </marker>
          </defs>
          <g v-for="item in view.edges" :key="item.edge.key" :data-key="item.edge.key">
            <line
              class="edge"
              :x1="item.from.x"
              :y1="item.from.y"
              :x2="item.to.x"
              :y2="item.to.y"
              :stroke-width="item.width"
              marker-end="url(#arrow)"
            />
            <line
              :x1="item.from.x"
              :y1="item.from.y"
              :x2="item.to.x"
              :y2="item.to.y"
              stroke="transparent"
              stroke-width="14"
              :data-tip="item.tooltip"
            />
          </g>
          <g v-for="node in view.nodes" :key="node.name" :data-key="node.name">
            <circle
              :cx="node.point.x"
              :cy="node.point.y"
              r="9"
              :style="{ fill: node.fill, stroke: 'var(--surface)', strokeWidth: '2' }"
              :opacity="node.opacity"
            />
            <text class="node-label" :x="node.point.x" :y="node.point.y + 24" text-anchor="middle">{{ node.label }}</text>
          </g>
        </svg>
        <div v-else class="empty">No session-to-session messages found yet.</div>
        <p class="sub">
          {{ view.sessionCount }} session message{{ view.sessionCount === 1 ? '' : 's' }} · {{ view.subagentCount }} subagent hand-back{{ view.subagentCount === 1 ? '' : 's' }} (recent)
        </p>
      </template>
    </div>
    <ul class="feed">
      <li v-for="message in view?.feed ?? []" :key="feedKey(message)" :data-key="feedKey(message)">
        <div class="feed__meta">
          {{ routeText(message) }} · {{ message.kind === 'subagent' ? 'subagent hand-back' : 'session message' }} ·
          <RelativeTime kind="ago" :timestamp-ms="message.tsMs" />
        </div>
        <div>{{ message.snippet }}</div>
      </li>
      <li v-if="view && !view.feed.length" class="empty">Nothing yet.</li>
    </ul>
  </div>
</template>
