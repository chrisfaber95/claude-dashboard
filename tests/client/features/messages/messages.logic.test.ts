// Message graph: nodes, edges and layout of the messages between sessions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MessageInfo } from '../../../../src/shared/types/index.ts';
import { buildMessageGraph, GRAPH_HEIGHT, GRAPH_WIDTH } from '../../../../src/client/features/messages/messages.logic.ts';

const message = (direction: 'in' | 'out', sessionName: string, peer: string): MessageInfo => ({
  tsMs: 0, kind: 'session', direction, sessionId: sessionName, sessionName, peer, snippet: '',
});

test('buildMessageGraph with no sessions has no nodes or edges', () => {
  const graph = buildMessageGraph([], []);
  assert.deepEqual(graph.nodes, []);
  assert.deepEqual(graph.edges, []);
});

test('a single node sits in the centre', () => {
  const graph = buildMessageGraph(['solo'], []);
  assert.deepEqual(graph.positions.get('solo'), { x: GRAPH_WIDTH / 2, y: GRAPH_HEIGHT / 2 });
});

test('edges follow the direction and count repeated messages', () => {
  const graph = buildMessageGraph(['a'], [message('out', 'a', 'b'), message('out', 'a', 'b'), message('in', 'a', 'b')]);
  assert.deepEqual(graph.nodes, ['a', 'b']);
  const summary = graph.edges.map(({ from, to, count }) => ({ from, to, count }));
  assert.deepEqual(summary, [{ from: 'a', to: 'b', count: 2 }, { from: 'b', to: 'a', count: 1 }]);
  assert.equal(graph.positions.size, 2);
});
