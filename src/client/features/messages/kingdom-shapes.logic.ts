// Pure drawing parts of the kingdom (no DOM): each object becomes a list of classed SVG paths, geometry only
// through shared/iso.ts.
import type { Cell, ScreenPoint } from '../../shared/iso.ts';
import { cellCentre, cellCorners, facePatch, isoBox, isoPoint, polygonPath } from '../../shared/iso.ts';
import type { BoxFaces } from '../../shared/iso.ts';
import type { BuildingKind } from './kingdom-grouping.logic.ts';

/** One painted path of a scene object; `tip` becomes its tooltip. */
export interface ScenePart {
  className: string;
  d: string;
  tip?: string;
}

/** Body and roof height of a building kind, in SVG units: the hall is the tallest, the house the lowest. */
export const KIND_HEIGHTS = {
  hall: { body: 64, roof: 38 },
  guild: { body: 46, roof: 12 },
  workshop: { body: 34, roof: 26 },
  house: { body: 26, roof: 20 },
} as const satisfies Record<BuildingKind, { body: number; roof: number }>;

export const CASTLE_KEEP_HEIGHT = 84;
export const CASTLE_UPPER_HEIGHT = 52;
export const WALL_HEIGHT = 16;
export const TOWER_HEIGHT = 42;
const TOWER_ROOF_HEIGHT = 16;
const CASTLE_UPPER_INSET = 0.22;
const CHIMNEY_INSET = 0.15;
const CHIMNEY_HEIGHT = 18;
const CHIMNEY_SINK = 10;
const SLAB_INSET = 0.12;
const SLAB_HEIGHT = 8;
const FLAG_POLE_HEIGHT = 44;
const FLAG_POLE_WIDTH = 1.5;
const FLAG_WIDTH = 24;
const FLAG_DROP = 14;
const SMOKE_PUFFS = 3;
const SMOKE_LIFT = 14;
const SMOKE_STEP = 9;
const SMOKE_DRIFT = 4;
const SMOKE_RADIUS = 3;
const WORKER_SPACING = 10;
const WORKER_RADIUS = 4;
const WORKER_RAISE = 4;
const TREE_TRUNK_HEIGHT = 16;
const TREE_TRUNK_INSET = 0.42;
const TREE_CANOPY_RADIUS = 17;
const MAILMAN_RADIUS = 5;
const MAILMAN_HEIGHT = 10;
const WINDOW_WIDTH = 0.26;
const WINDOW_HEIGHT = 0.22;
const WINDOW_STARTS = [0.12, 0.62];
const WINDOW_ROW_TOPS_TWO = [0.12, 0.42];
const WINDOW_ROW_TOPS_ONE = [0.2];

function pathOf(className: string, points: readonly ScreenPoint[]): ScenePart {
  return { className, d: polygonPath(points) };
}

/** A circle as path data, so every part of the scene is one `<path>`. */
export function circlePath(centre: ScreenPoint, radius: number): string {
  const round = (value: number): number => Math.round(value * 10) / 10;
  const startX = round(centre.x - radius);
  const centreY = round(centre.y);
  const diameter = round(radius * 2);
  return `M${startX} ${centreY}a${radius} ${radius} 0 1 0 ${diameter} 0a${radius} ${radius} 0 1 0 -${diameter} 0Z`;
}

/** The three faces of a box inset from the cell edges, standing on `base` and `height` tall. */
export function insetBox(cell: Cell, inset: number, base: number, height: number): BoxFaces {
  const near = inset;
  const far = 1 - inset;
  const corner = (col: number, row: number, lift: number): ScreenPoint => isoPoint(cell.col + col, cell.row + row, lift);
  const top = base + height;
  const topBack = corner(near, near, top);
  const topRight = corner(far, near, top);
  const topFront = corner(far, far, top);
  const topLeft = corner(near, far, top);
  const baseRight = corner(far, near, base);
  const baseFront = corner(far, far, base);
  const baseLeft = corner(near, far, base);
  return {
    top: [topBack, topRight, topFront, topLeft],
    left: [topLeft, topFront, baseFront, baseLeft],
    right: [topFront, topRight, baseRight, baseFront],
  };
}

function boxParts(faces: BoxFaces): ScenePart[] {
  return [
    pathOf('iso__face--left', faces.left),
    pathOf('iso__face--right', faces.right),
    pathOf('iso__face--top', faces.top),
  ];
}

function pyramidParts(cell: Cell, base: number, height: number): ScenePart[] {
  const [, right, front, left] = cellCorners(cell, base);
  const apex = isoPoint(cell.col + 0.5, cell.row + 0.5, base + height);
  if (!right || !front || !left) return [];
  return [pathOf('kingdom__roof--left', [left, front, apex]), pathOf('kingdom__roof--right', [front, right, apex])];
}

function windowParts(faces: BoxFaces, hasTwoRows: boolean): ScenePart[] {
  const rowTops = hasTwoRows ? WINDOW_ROW_TOPS_TWO : WINDOW_ROW_TOPS_ONE;
  return [faces.left, faces.right].flatMap((face) =>
    rowTops.flatMap((top) =>
      WINDOW_STARTS.map((start) =>
        pathOf('iso__window', facePatch(face, start, start + WINDOW_WIDTH, top, top + WINDOW_HEIGHT)),
      ),
    ),
  );
}

function shutterParts(faces: BoxFaces): ScenePart[] {
  return [faces.left, faces.right].map((face) => pathOf('kingdom__shutter', facePatch(face, 0.08, 0.92, 0.12, 0.7)));
}

function chimneyParts(cell: Cell, roofTop: number, isActive: boolean): ScenePart[] {
  const stack = insetBox(cell, 0.5 - CHIMNEY_INSET, roofTop - CHIMNEY_SINK, CHIMNEY_HEIGHT);
  const smoke = Array.from({ length: SMOKE_PUFFS }, (_, index) => {
    const centre = isoPoint(cell.col + 0.5, cell.row + 0.5, roofTop + SMOKE_LIFT + index * SMOKE_STEP);
    const drifted = { x: centre.x + index * SMOKE_DRIFT, y: centre.y };
    return { className: 'kingdom__smoke', d: circlePath(drifted, SMOKE_RADIUS + index) };
  });
  return [...boxParts(stack), ...(isActive ? smoke : [])];
}

/** A building: body, windows, door, roof and chimney; shutters and a barred door when it is stopped. */
export function buildingParts(cell: Cell, kind: BuildingKind, state: 'active' | 'idle' | 'stopped'): ScenePart[] {
  const { body, roof } = KIND_HEIGHTS[kind];
  const faces = isoBox(cell, body);
  const roofParts =
    kind === 'guild' ? boxParts(insetBox(cell, SLAB_INSET, body, SLAB_HEIGHT)) : pyramidParts(cell, body, roof);
  const closed =
    state === 'stopped'
      ? [...shutterParts(faces), pathOf('kingdom__bar', facePatch(faces.left, 0.36, 0.64, 0.7, 0.8))]
      : [];
  return [
    ...boxParts(faces),
    ...windowParts(faces, kind === 'hall'),
    pathOf('iso__door', facePatch(faces.left, 0.4, 0.6, 0.5, 1)),
    ...closed,
    ...roofParts,
    ...chimneyParts(cell, body + roof, state === 'active'),
  ];
}

/** The subagents of a building, standing in a row in front of it. */
export function workerParts(cell: Cell, workers: readonly { agentType: string; activity: string }[]): ScenePart[] {
  const front = isoPoint(cell.col + 1, cell.row + 1);
  return workers.map((worker, index) => {
    const centre = { x: front.x + (index - (workers.length - 1) / 2) * WORKER_SPACING, y: front.y - WORKER_RAISE };
    return { className: 'kingdom__worker', d: circlePath(centre, WORKER_RADIUS), tip: `${worker.agentType}: ${worker.activity}` };
  });
}

/** The castle: a keep with a smaller upper hall, a gate and, only while it needs the user, a banner. */
export function castleParts(cell: Cell, needsYou: boolean): ScenePart[] {
  const keep = isoBox(cell, CASTLE_KEEP_HEIGHT);
  const upper = insetBox(cell, CASTLE_UPPER_INSET, CASTLE_KEEP_HEIGHT, CASTLE_UPPER_HEIGHT);
  const parts = [
    ...boxParts(keep),
    ...windowParts(keep, true),
    pathOf('iso__door', facePatch(keep.left, 0.35, 0.65, 0.45, 1)),
    ...boxParts(upper),
    ...windowParts(upper, false),
  ];
  if (!needsYou) return parts;
  const base = isoPoint(cell.col + 0.5, cell.row + 0.5, CASTLE_KEEP_HEIGHT + CASTLE_UPPER_HEIGHT);
  const tip = { x: base.x, y: base.y - FLAG_POLE_HEIGHT };
  const pole = [base, tip, { x: tip.x + FLAG_POLE_WIDTH, y: tip.y }, { x: base.x + FLAG_POLE_WIDTH, y: base.y }];
  const banner = [tip, { x: tip.x + FLAG_WIDTH, y: tip.y + FLAG_DROP / 2 }, { x: tip.x, y: tip.y + FLAG_DROP }];
  return [...parts, pathOf('kingdom__pole', pole), pathOf('kingdom__flag', banner)];
}

/** A low wall piece. */
export function wallParts(cell: Cell): ScenePart[] {
  return boxParts(isoBox(cell, WALL_HEIGHT));
}

/** A wall tower: a tall box with a small roof. */
export function towerParts(cell: Cell): ScenePart[] {
  return [...boxParts(isoBox(cell, TOWER_HEIGHT)), ...pyramidParts(cell, TOWER_HEIGHT, TOWER_ROOF_HEIGHT)];
}

/** A well on the square: a short stone ring with a small cover on top. */
export function wellParts(cell: Cell): ScenePart[] {
  return [...boxParts(insetBox(cell, 0.28, 0, 12)), ...boxParts(insetBox(cell, 0.4, 24, 5))];
}

/** A market stall: a low counter under an awning. */
export function stallParts(cell: Cell): ScenePart[] {
  return [...boxParts(insetBox(cell, 0.2, 0, 14)), ...boxParts(insetBox(cell, 0.1, 30, 4))];
}

/** A tree: trunk and round canopy. */
export function treeParts(cell: Cell): ScenePart[] {
  const centre = cellCentre(cell);
  const canopy = { x: centre.x, y: centre.y - TREE_TRUNK_HEIGHT - TREE_CANOPY_RADIUS / 2 };
  const trunk = boxParts(insetBox(cell, TREE_TRUNK_INSET, 0, TREE_TRUNK_HEIGHT));
  return [
    ...trunk.map((part) => ({ ...part, className: 'kingdom__trunk' })),
    { className: 'kingdom__canopy', d: circlePath(canopy, TREE_CANOPY_RADIUS) },
  ];
}

/** A mailman standing at a door. */
export function mailmanParts(door: Cell, tip: string): ScenePart[] {
  const centre = cellCentre(door);
  const head = { x: centre.x, y: centre.y - MAILMAN_HEIGHT };
  return [{ className: 'kingdom__mailman', d: circlePath(head, MAILMAN_RADIUS), tip }];
}
