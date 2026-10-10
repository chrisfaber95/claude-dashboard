import type { DashboardState, MessageInfo } from '../../../shared/types/index.ts';
import { patchHtml } from '../../app/patch.ts';
import { elementById } from '../../shared/dom.ts';
import { esc } from '../../shared/escape.ts';
import { timeSpan } from '../../shared/time.ts';
import { GRAPH_HEIGHT, GRAPH_WIDTH, buildMessageGraph } from './messages.logic.ts';
import type { GraphPoint, MessageEdge } from './messages.logic.ts';

const FEED_ENTRIES_SHOWN = 40;
const NODE_LABEL_MAX = 18;
const NODE_COLOR_SLOTS = 8;
const EDGE_WIDTH_MAX = 5;

function edgeHtml(edge: MessageEdge, from: GraphPoint, to: GraphPoint): string {
  const tooltip = `${esc(edge.from)} → ${esc(edge.to)}: ${edge.count} message${edge.count > 1 ? 's' : ''}`;
  return `<g data-key="${esc(edge.key)}"><line class="edge" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke-width="${Math.min(1 + edge.count, EDGE_WIDTH_MAX)}" marker-end="url(#arrow)"/>
        <line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="transparent" stroke-width="14" data-tip="${tooltip}"/></g>`;
}

function nodeHtml(name: string, index: number, point: GraphPoint, isLive: boolean): string {
  const label = name.length > NODE_LABEL_MAX ? `${name.slice(0, NODE_LABEL_MAX - 1)}…` : name;
  return `<g data-key="${esc(name)}"><circle cx="${point.x}" cy="${point.y}" r="9" style="fill:var(--s${(index % NODE_COLOR_SLOTS) + 1});stroke:var(--surface);stroke-width:2" opacity="${isLive ? 1 : 0.5}"/>
        <text class="node-label" x="${point.x}" y="${point.y + 24}" text-anchor="middle">${esc(label)}</text></g>`;
}

function graphHtml(state: DashboardState, sessionMessages: MessageInfo[]): string {
  const sessionNames = state.sessions.map((session) => session.name);
  const graph = buildMessageGraph(sessionNames, sessionMessages);
  const liveNames = new Set(sessionNames);
  const edges = graph.edges.map((edge) => edgeHtml(edge, graph.positions.get(edge.from)!, graph.positions.get(edge.to)!)).join('');
  const nodes = graph.nodes.map((name, index) => nodeHtml(name, index, graph.positions.get(name)!, liveNames.has(name))).join('');
  return `<svg class="chart" viewBox="0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}" role="img" aria-label="Message graph between sessions">
              <defs><marker id="arrow" viewBox="0 0 8 8" refX="14" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" style="fill:var(--muted)"/></marker></defs>
              ${edges}${nodes}</svg>`;
}

function feedItemHtml(message: MessageInfo): string {
  const key = `${message.tsMs}|${message.kind}|${message.direction}|${message.sessionId}|${message.peer}`;
  const route =
    message.direction === 'out'
      ? `${esc(message.sessionName)} → ${esc(message.peer)}`
      : `${esc(message.peer)} → ${esc(message.sessionName)}`;
  return `<li data-key="${esc(key)}"><div class="feed__meta">${route}
        · ${message.kind === 'subagent' ? 'subagent hand-back' : 'session message'} · ${timeSpan('ago', message.tsMs)}</div><div>${esc(message.snippet)}</div></li>`;
}

/** Draw the session-to-session message graph and the message feed into `#comms`. */
export function renderMessages(state: DashboardState): void {
  const sessionMessages = state.messages.filter((message) => message.kind === 'session');
  const subagentCount = state.messages.filter((message) => message.kind === 'subagent').length;
  const feed = state.messages.slice(0, FEED_ENTRIES_SHOWN).map(feedItemHtml).join('');
  const graph = sessionMessages.length
    ? graphHtml(state, sessionMessages)
    : '<div class="empty">No session-to-session messages found yet.</div>';
  patchHtml(elementById('comms'), `<h2 id="h-comms">Session communication</h2>
    <div class="split"><div>
      ${graph}
      <p class="sub">${sessionMessages.length} session message${sessionMessages.length === 1 ? '' : 's'} · ${subagentCount} subagent hand-back${subagentCount === 1 ? '' : 's'} (recent)</p>
    </div><ul class="feed">${feed || '<li class="empty">Nothing yet.</li>'}</ul></div>`);
}
