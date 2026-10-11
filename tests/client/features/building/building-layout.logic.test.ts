import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { annexLayout, sceneGeometry } from '../../../../src/client/features/building/building-layout.logic.ts';
import { ANNEX_ROW_HEIGHT, BASE_HEIGHT, ROOF_HEIGHT, ROOM_GAP, ROOM_HEIGHT } from '../../../../src/client/features/building/building.logic.ts';
import type { SessionInfo, SubagentInfo } from '../../../../src/shared/types/index.ts';

function session(id: string): SessionInfo {
  return {
    sessionId: id,
    pid: 1,
    name: id,
    project: 'demo',
    cwd: '',
    status: 'idle',
    entrypoint: 'cli',
    kind: 'interactive',
    startedAtMs: 1,
    updatedAtMs: 1,
    branch: null,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

function subagent(id: string, sessionId: string, parentAgentId: string | null = null, state: 'working' | 'done' = 'working'): SubagentInfo {
  return {
    agentId: id,
    sessionId,
    project: 'demo',
    agentType: 'Explore',
    description: '',
    prompt: '',
    background: false,
    parentAgentId,
    startedAtMs: 1,
    lastTsMs: 1,
    state,
    handedBack: false,
    activity: '',
    result: '',
    tokens: 0,
  };
}

describe('sceneGeometry', () => {
  it('gives an empty project one empty slot on a single floor', () => {
    const geometry = sceneGeometry([], []);
    assert.equal(geometry.slots.length, 1);
    assert.equal(geometry.slots[0]?.session, null);
    assert.equal(geometry.roomsBottom, ROOF_HEIGHT + ROOM_GAP + ROOM_HEIGHT);
    assert.equal(geometry.height, geometry.roomsBottom + ROOM_GAP + BASE_HEIGHT);
  });

  it('puts the first sessions on the ground floor and makes a floor taller for its annex', () => {
    const sessions = ['a', 'b', 'c'].map(session);
    const geometry = sceneGeometry(sessions, [subagent('x', 'a')]);
    assert.equal(geometry.columns, 2);
    const [first, second, third] = geometry.slots;
    assert.equal(first?.y, second?.y);
    assert.ok((third?.y ?? 1) < (first?.y ?? 0), 'the later session stacks above the ground floor');
    const groundFloorTop = ROOF_HEIGHT + ROOM_GAP + ROOM_HEIGHT + ROOM_GAP;
    assert.equal(third?.y, ROOF_HEIGHT + ROOM_GAP);
    assert.equal(first?.y, groundFloorTop);
    assert.equal(geometry.roomsBottom, groundFloorTop + ROOM_HEIGHT + ANNEX_ROW_HEIGHT);
    assert.deepEqual(first?.subagents.map((entry) => entry.agentId), ['x']);
  });
});

describe('annexLayout', () => {
  it('has no pipes for no subagents', () => {
    assert.deepEqual(annexLayout([]), { cubicles: [], pipePaths: [], nestedPipePaths: [], mail: [] });
  });

  it('wraps cubicles into rows of three and sends mail only to working ones from the main session', () => {
    const layout = annexLayout([
      subagent('a', 's'),
      subagent('b', 's', null, 'done'),
      subagent('c', 's', 'a'),
      subagent('d', 's'),
    ]);
    assert.deepEqual(layout.cubicles.map((cubicle) => [cubicle.row, cubicle.column]), [[0, 0], [0, 1], [0, 2], [1, 0]]);
    assert.deepEqual(layout.mail.map((mail) => mail.agentId), ['a', 'd']);
    assert.equal(layout.nestedPipePaths.length, 1);
    assert.equal(layout.pipePaths.length, 3, 'trunk plus one bus per row');
  });

  it('treats a subagent whose parent is unknown as handed down by the main session', () => {
    const layout = annexLayout([subagent('a', 's', 'missing')]);
    assert.equal(layout.cubicles[0]?.isNested, false);
    assert.equal(layout.nestedPipePaths.length, 0);
  });
});
