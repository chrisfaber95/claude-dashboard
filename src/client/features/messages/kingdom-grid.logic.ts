// Pure grid helpers of the kingdom layout: neighbours, growing a region, and walking over cells.
import type { Cell } from '../../shared/iso.ts';
import type { WallReach } from './kingdom-layout-types.logic.ts';

const DIAMOND_STEPS: readonly Cell[] = [
  { col: 1, row: 0 },
  { col: -1, row: 0 },
  { col: 0, row: 1 },
  { col: 0, row: -1 },
];
const SQUARE_STEPS: readonly Cell[] = [
  ...DIAMOND_STEPS,
  { col: 1, row: 1 },
  { col: 1, row: -1 },
  { col: -1, row: 1 },
  { col: -1, row: -1 },
];

/** Map key of a cell. */
export function cellKey(cell: Cell): string {
  return `${cell.col},${cell.row}`;
}

/** The cells touching `cell`: four for `diamond`, eight for `square`. */
export function neighboursOf(cell: Cell, reach: WallReach): Cell[] {
  const steps = reach === 'square' ? SQUARE_STEPS : DIAMOND_STEPS;
  return steps.map((step) => ({ col: cell.col + step.col, row: cell.row + step.row }));
}

/** The cells next to the region, not in it, each once. */
export function ringAround(cells: readonly Cell[], reach: WallReach): Cell[] {
  const inside = new Set(cells.map(cellKey));
  const ring = new Map<string, Cell>();
  for (const cell of cells) {
    for (const next of neighboursOf(cell, reach)) {
      const key = cellKey(next);
      if (!inside.has(key)) ring.set(key, next);
    }
  }
  return [...ring.values()];
}

/** The region with `steps` rings added around it. */
export function growBy(cells: readonly Cell[], reach: WallReach, steps: number): Cell[] {
  let grown = [...cells];
  for (let step = 0; step < steps; step++) grown = [...grown, ...ringAround(grown, reach)];
  return grown;
}

function walkBackTo(cameFrom: ReadonlyMap<string, Cell | null>, end: Cell): Cell[] {
  const walk: Cell[] = [];
  let current: Cell | null | undefined = end;
  while (current) {
    walk.push(current);
    current = cameFrom.get(cellKey(current));
  }
  return walk.reverse();
}

/** The shortest walk from one cell to another over walkable cells, both ends included; empty if none. */
export function findWalk(walkable: ReadonlySet<string>, from: Cell, to: Cell): Cell[] {
  const goalKey = cellKey(to);
  if (!walkable.has(cellKey(from)) || !walkable.has(goalKey)) return [];
  const cameFrom = new Map<string, Cell | null>([[cellKey(from), null]]);
  const queue: Cell[] = [from];
  for (const cell of queue) {
    if (cellKey(cell) === goalKey) return walkBackTo(cameFrom, cell);
    for (const next of neighboursOf(cell, 'diamond')) {
      const key = cellKey(next);
      if (!walkable.has(key) || cameFrom.has(key)) continue;
      cameFrom.set(key, cell);
      queue.push(next);
    }
  }
  return [];
}

/** Start, every turn and end of a walk: the corner list `walkRoute` expands again. */
export function cornersOf(walk: readonly Cell[]): Cell[] {
  return walk.filter((cell, index) => {
    const before = walk[index - 1];
    const after = walk[index + 1];
    if (!before || !after) return true;
    return before.col !== after.col && before.row !== after.row;
  });
}
