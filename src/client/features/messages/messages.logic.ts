// Pure layout of the session-message graph (no DOM): testable with node --test.
import type { MessageInfo } from '../../../shared/types/index.ts';

export const GRAPH_WIDTH = 420;
export const GRAPH_HEIGHT = 260;
const NODE_RING_MARGIN = 44;
const KEY_SEPARATOR = '\u0000';

/** A direction of messages between two named sessions, with how many there were. */
export interface MessageEdge {
  key: string;
  from: string;
  to: string;
  count: number;
}

/** Position of one node in graph coordinates. */
export interface GraphPoint {
  x: number;
  y: number;
}

/** The messages graph: nodes on a circle and one edge per sender/receiver pair. */
export interface MessageGraph {
  nodes: string[];
  edges: MessageEdge[];
  positions: Map<string, GraphPoint>;
}

/** Place live sessions and message peers as nodes on a circle, one edge per sender/receiver pair. */
export function buildMessageGraph(sessionNames: readonly string[], sessionMessages: readonly MessageInfo[]): MessageGraph {
  const names = new Set<string>(sessionNames);
  const edgeByKey = new Map<string, MessageEdge>();
  for (const message of sessionMessages) {
    const from = message.direction === 'out' ? message.sessionName : message.peer;
    const to = message.direction === 'out' ? message.peer : message.sessionName;
    names.add(from);
    names.add(to);
    const key = `${from}${KEY_SEPARATOR}${to}`;
    const edge = edgeByKey.get(key);
    if (edge) edge.count++;
    else edgeByKey.set(key, { key, from, to, count: 1 });
  }
  const nodes = [...names];
  const centerX = GRAPH_WIDTH / 2;
  const centerY = GRAPH_HEIGHT / 2;
  const radius = Math.min(GRAPH_WIDTH, GRAPH_HEIGHT) / 2 - NODE_RING_MARGIN;
  const positions = new Map<string, GraphPoint>(
    nodes.map((name, index) => {
      const angle = (index / Math.max(1, nodes.length)) * Math.PI * 2 - Math.PI / 2;
      const isOnlyNode = nodes.length === 1;
      return [name, { x: isOnlyNode ? centerX : centerX + radius * Math.cos(angle), y: isOnlyNode ? centerY : centerY + radius * Math.sin(angle) }];
    }),
  );
  return { nodes, edges: [...edgeByKey.values()], positions };
}

const NODE_LABEL_MAX = 18;

/** Shorten a session name to fit under its graph node. */
export function nodeLabel(name: string): string {
  return name.length > NODE_LABEL_MAX ? `${name.slice(0, NODE_LABEL_MAX - 1)}…` : name;
}

/** Tooltip text of one graph edge: "a → b: 3 messages". */
export function edgeTooltip(edge: MessageEdge): string {
  return `${edge.from} → ${edge.to}: ${edge.count} message${edge.count > 1 ? 's' : ''}`;
}

/** Stable key of one feed entry. */
export function feedKey(message: MessageInfo): string {
  return `${message.tsMs}|${message.kind}|${message.direction}|${message.sessionId}|${message.peer}`;
}

/** "sender → receiver" of one message, from the viewpoint of the session that logged it. */
export function routeText(message: MessageInfo): string {
  return message.direction === 'out' ? `${message.sessionName} → ${message.peer}` : `${message.peer} → ${message.sessionName}`;
}
