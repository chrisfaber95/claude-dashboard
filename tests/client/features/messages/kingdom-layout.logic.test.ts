// Kingdom layout: wide and tall arrangements, stable cells, doors on paths, walls, and mailman routes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cellDepth, walkRoute } from '../../../../src/client/shared/iso.ts';
import type { Cell } from '../../../../src/client/shared/iso.ts';
import { cellKey, neighboursOf } from '../../../../src/client/features/messages/kingdom-grid.logic.ts';
import { createKingdomLayoutTracker, mailmanRoute } from '../../../../src/client/features/messages/kingdom-layout.logic.ts';
import type { KingdomLayout, KingdomOrientation } from '../../../../src/client/features/messages/kingdom-layout.logic.ts';
import { COURT_ID } from '../../../../src/client/features/messages/kingdom-grouping.logic.ts';
import { CASTLE_ID } from '../../../../src/client/features/messages/kingdom-types.logic.ts';
import type { Kingdom, KingdomArea, KingdomBuilding } from '../../../../src/client/features/messages/kingdom-types.logic.ts';

const MAX_TALL_WIDTH = 400;

function building(name: string, areaId: string, slot: number): KingdomBuilding {
  return { name, kind: 'house', state: 'idle', idleMs: 0, areaId, slot, workers: [], moreWorkers: 0 };
}

function area(id: string, count: number, firstSlot = 0): KingdomArea {
  const buildings = Array.from({ length: count }, (_, index) => building(`${id}-${index}`, id, firstSlot + index));
  return { id, kind: id === COURT_ID ? 'court' : 'district', buildings };
}

function kingdomOf(...areas: KingdomArea[]): Kingdom {
  return { castle: { id: CASTLE_ID, needsYou: false }, areas, mailmen: [] };
}

const ORIENTATIONS: KingdomOrientation[] = ['wide', 'tall'];
const FULL = kingdomOf(area(COURT_ID, 12), area('alpha', 12), area('beta', 7), area('gamma', 3), area('delta', 12));

const keyOf = (cell: Cell): string => cellKey(cell);

function layoutOf(kingdom: Kingdom, orientation: KingdomOrientation): KingdomLayout {
  return createKingdomLayoutTracker().arrange(kingdom, orientation);
}

function solidKeys(layout: KingdomLayout): Set<string> {
  return new Set([layout.castle, layout.well, layout.stall, ...layout.buildings.map((item) => item.cell)].map(keyOf));
}

function widthOf(viewBox: string): number {
  return Number(viewBox.split(' ')[2]);
}

test('wide: castle beside the square, court around it, districts on their own plots', () => {
  const layout = layoutOf(FULL, 'wide');
  const squareKeys = new Set(layout.square.map(keyOf));
  assert.ok(squareKeys.has(keyOf(layout.gate)) === false, 'the gate is a path, not a square cell');
  assert.ok(neighboursOf(layout.castle, 'diamond').some((cell) => keyOf(cell) === keyOf(layout.gate)));
  assert.ok(neighboursOf(layout.gate, 'diamond').some((cell) => squareKeys.has(keyOf(cell))));
  assert.ok(neighboursOf(layout.well, 'diamond').some((cell) => squareKeys.has(keyOf(cell))));
  assert.ok(neighboursOf(layout.stall, 'diamond').some((cell) => squareKeys.has(keyOf(cell))));

  const court = layout.buildings.filter((item) => item.areaId === COURT_ID);
  assert.equal(court.length, 12);
  const [firstCourt] = court;
  assert.ok(firstCourt && neighboursOf(firstCourt.cell, 'diamond').some((cell) => squareKeys.has(keyOf(cell)) || keyOf(cell) === keyOf(layout.gate)));
  assert.equal(layout.overflow.length, 0);
  assert.equal(new Set(layout.buildings.map((item) => keyOf(item.cell))).size, layout.buildings.length, 'one building per cell');
});

test('areas never touch: another area is at least two cells away', () => {
  for (const orientation of ORIENTATIONS) {
    const layout = layoutOf(FULL, orientation);
    for (const first of layout.buildings) {
      for (const second of layout.buildings) {
        if (first.areaId === second.areaId) continue;
        const gap = Math.max(Math.abs(first.cell.col - second.cell.col), Math.abs(first.cell.row - second.cell.row));
        assert.ok(gap >= 2, `${orientation}: ${first.name} touches ${second.name}`);
      }
    }
  }
});

test('the wall is a closed ring around everything, with towers', () => {
  for (const orientation of ORIENTATIONS) {
    const layout = layoutOf(FULL, orientation);
    assert.ok(layout.towers.length > 0, `${orientation}: towers`);
    const wallKeys = new Set([...layout.wall, ...layout.towers].map(keyOf));
    const inside = [layout.castle, layout.gate, ...layout.square, ...layout.paths, ...layout.buildings.map((item) => item.cell)];
    const cols = [...wallKeys].map((key) => Number(key.split(',')[0]));
    const rows = [...wallKeys].map((key) => Number(key.split(',')[1]));
    const [minCol, maxCol, minRow, maxRow] = [Math.min(...cols) - 1, Math.max(...cols) + 1, Math.min(...rows) - 1, Math.max(...rows) + 1];
    const seen = new Set<string>([`${minCol},${minRow}`]);
    const queue: Cell[] = [{ col: minCol, row: minRow }];
    for (const cell of queue) {
      for (const next of neighboursOf(cell, 'diamond')) {
        const key = keyOf(next);
        const isOutOfBox = next.col < minCol || next.col > maxCol || next.row < minRow || next.row > maxRow;
        if (isOutOfBox || seen.has(key) || wallKeys.has(key)) continue;
        seen.add(key);
        queue.push(next);
      }
    }
    assert.ok(inside.every((cell) => !seen.has(keyOf(cell))), `${orientation}: something is outside the wall`);
    assert.ok(inside.every((cell) => !wallKeys.has(keyOf(cell))), `${orientation}: wall on a used cell`);
  }
});

test('trees stand only on free cells', () => {
  const layout = layoutOf(kingdomOf(area(COURT_ID, 3), area('alpha', 2)), 'wide');
  assert.ok(layout.trees.length > 0);
  const blocked = new Set([...solidKeys(layout), ...layout.square.map(keyOf), ...layout.paths.map(keyOf), ...layout.wall.map(keyOf), ...layout.towers.map(keyOf)]);
  assert.ok(layout.trees.every((tree) => !blocked.has(keyOf(tree))));
});

test('tall: castle on top, then court, then districts one below the other, narrow enough for a phone', () => {
  const layout = layoutOf(FULL, 'tall');
  assert.ok(widthOf(layout.viewBox) <= MAX_TALL_WIDTH, `width ${widthOf(layout.viewBox)}`);
  const depthsOf = (areaId: string): number[] => layout.buildings.filter((item) => item.areaId === areaId).map((item) => cellDepth(item.cell));
  const order = [COURT_ID, 'alpha', 'beta', 'gamma', 'delta'];
  assert.ok(cellDepth(layout.castle) < Math.min(...depthsOf(COURT_ID)));
  for (let i = 1; i < order.length; i++) {
    assert.ok(Math.max(...depthsOf(order[i - 1] ?? '')) < Math.min(...depthsOf(order[i] ?? '')), `${order[i]} below ${order[i - 1]}`);
  }
});

test('tall: width stays within 400 units with many districts', () => {
  const areas = Array.from({ length: 8 }, (_, index) => area(`district-${index}`, 12));
  const layout = layoutOf(kingdomOf(area(COURT_ID, 20), ...areas), 'tall');
  assert.ok(widthOf(layout.viewBox) <= MAX_TALL_WIDTH);
  assert.equal(layout.overflow.length, 0);
});

test('cells stay put while on screen, in both arrangements', () => {
  for (const orientation of ORIENTATIONS) {
    const tracker = createKingdomLayoutTracker();
    const steps = [
      kingdomOf(area(COURT_ID, 2), area('alpha', 2)),
      kingdomOf(area(COURT_ID, 3), area('alpha', 3), area('beta', 1)),
      kingdomOf(area(COURT_ID, 3), area('alpha', 3), area('beta', 1), area('gamma', 5)),
      kingdomOf(area(COURT_ID, 3), area('alpha', 3), area('gamma', 5), area('delta', 2)),
    ];
    const first = tracker.arrange(steps[0] ?? kingdomOf(), orientation);
    const known = new Map(first.buildings.map((item) => [item.name, keyOf(item.cell)]));
    const fixed = [keyOf(first.castle), first.square.map(keyOf).join('|'), keyOf(first.gate)];
    for (const step of steps.slice(1)) {
      const next = tracker.arrange(step, orientation);
      const alive = new Set(next.buildings.map((item) => item.name));
      for (const item of next.buildings) {
        const before = known.get(item.name);
        if (before !== undefined) assert.equal(keyOf(item.cell), before, `${orientation}: ${item.name} moved`);
        known.set(item.name, keyOf(item.cell));
      }
      for (const name of [...known.keys()]) if (!alive.has(name)) known.delete(name);
      assert.deepEqual([keyOf(next.castle), next.square.map(keyOf).join('|'), keyOf(next.gate)], fixed);
    }
  }
});

test('every door is on a path next to its building, and every path connects to the square', () => {
  for (const orientation of ORIENTATIONS) {
    const layout = layoutOf(FULL, orientation);
    for (const item of layout.buildings) {
      assert.ok(layout.walkable.has(keyOf(item.door)), `${orientation}: door of ${item.name}`);
      assert.ok(neighboursOf(item.cell, 'diamond').some((cell) => keyOf(cell) === keyOf(item.door)));
    }
    const reached = new Set(layout.square.map(keyOf));
    const queue = [...layout.square];
    for (const cell of queue) {
      for (const next of neighboursOf(cell, 'diamond')) {
        if (!layout.walkable.has(keyOf(next)) || reached.has(keyOf(next))) continue;
        reached.add(keyOf(next));
        queue.push(next);
      }
    }
    for (const path of layout.paths) assert.ok(reached.has(keyOf(path)), `${orientation}: path ${keyOf(path)} is cut off`);
    assert.ok(reached.has(keyOf(layout.gate)));
  }
});

test('a mailman walks only over path or square cells, door to door or to the gate', () => {
  for (const orientation of ORIENTATIONS) {
    const layout = layoutOf(FULL, orientation);
    const solid = solidKeys(layout);
    const wallKeys = new Set([...layout.wall, ...layout.towers, ...layout.trees].map(keyOf));
    const pairs = [
      { from: 'alpha-0', to: 'delta-11' },
      { from: `${COURT_ID}-0`, to: 'gamma-2' },
      { from: 'beta-3', to: CASTLE_ID },
      { from: 'alpha-4', to: 'alpha-5' },
    ];
    for (const pair of pairs) {
      const corners = mailmanRoute(layout, { ...pair, insideBuilding: null });
      assert.ok(corners.length > 0, `${orientation}: ${pair.from} to ${pair.to}`);
      const route = walkRoute(corners);
      for (const cell of route) {
        assert.ok(layout.walkable.has(keyOf(cell)), `${orientation}: step off the paths at ${keyOf(cell)}`);
        assert.ok(!solid.has(keyOf(cell)) && !wallKeys.has(keyOf(cell)));
      }
      const sender = layout.buildings.find((item) => item.name === pair.from);
      assert.deepEqual(route[0], sender?.door);
      const receiver = layout.buildings.find((item) => item.name === pair.to);
      assert.deepEqual(route[route.length - 1], pair.to === CASTLE_ID ? layout.gate : receiver?.door);
    }
  }
});

test('no walk for a hand-back inside a building or for an unknown building', () => {
  const layout = layoutOf(FULL, 'wide');
  assert.deepEqual(mailmanRoute(layout, { from: 'alpha-0', to: 'boss', insideBuilding: 'alpha-0' }), []);
  assert.deepEqual(mailmanRoute(layout, { from: 'ghost', to: 'alpha-0', insideBuilding: null }), []);
});

test('a building beyond the capacity of its district is reported, not placed', () => {
  const layout = layoutOf(kingdomOf(area('alpha', 1, 12)), 'wide');
  assert.deepEqual(layout.overflow, ['alpha-0']);
  assert.equal(layout.buildings.length, 0);
});
