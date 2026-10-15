// Pure scene of the kingdom view (no DOM): the three layers of docs/isometric.md as plain data, from the kingdom
// model and its layout.
import type { Cell } from '../../shared/iso.ts';
import { cellCentre, cellCorners, cellDepth, isoPoint, polygonPath, walkRoute, walkSteps } from '../../shared/iso.ts';
import { COURT_ID } from './kingdom-grouping.logic.ts';
import { mailmanRoute } from './kingdom-layout.logic.ts';
import type { KingdomLayout, KingdomOrientation } from './kingdom-layout-types.logic.ts';
import {
  buildingParts,
  castleParts,
  mailmanParts,
  stallParts,
  towerParts,
  treeParts,
  walkerStepParts,
  wallParts,
  wellParts,
  workerParts,
} from './kingdom-shapes.logic.ts';
import type { ScenePart } from './kingdom-shapes.logic.ts';
import { CASTLE_ID } from './kingdom-types.logic.ts';
import type { Kingdom, KingdomBuilding, KingdomMailman } from './kingdom-types.logic.ts';

const TINT_SLOTS = 8;
const NAME_LABEL_MAX = 14;
const MINUTE_MS = 60_000;
const SECOND_MS = 1000;
const NAME_OFFSET = 12;
const STATUS_OFFSET = 23;
const AREA_LABEL_OFFSET = 4;
const OVERFLOW_OFFSET = 18;
const WORKER_MORE_OFFSET = 14;
const MAILMAN_DEPTH = 0.5;
const WORKER_DEPTH = 0.25;
const STEP_SECONDS = 0.9;
const COURT_LABEL = 'Court';
const CASTLE_LABEL = 'Castle';

/** One depth-sorted object of the scene layer. */
export interface SceneItem {
  key: string;
  depth: number;
  className: string;
  parts: ScenePart[];
  /** Custom properties for the item's CSS (walk end points, delays). */
  vars?: Record<string, string>;
}

/** One text of the label layer. */
export interface SceneLabel {
  key: string;
  className: string;
  x: number;
  y: number;
  text: string;
  tip?: string;
}

/** Everything the view draws, in layer order. */
export interface KingdomScene {
  orientation: KingdomOrientation;
  viewBox: string;
  backdrop: string;
  ground: ScenePart[];
  items: SceneItem[];
  labels: SceneLabel[];
}

/** Wide when the scene area is wider than tall; an unmeasured (zero) area stays wide. */
export function orientationFor(width: number, height: number): KingdomOrientation {
  return height > width && width > 0 ? 'tall' : 'wide';
}

/** Session name shortened to fit under its building. */
export function nameLabel(name: string): string {
  return name.length > NAME_LABEL_MAX ? `${name.slice(0, NAME_LABEL_MAX - 1)}…` : name;
}

/** "active", "idle 12 min" or "stopped". */
export function statusLabel(building: Pick<KingdomBuilding, 'state' | 'idleMs'>): string {
  if (building.state === 'stopped') return 'stopped';
  if (building.state === 'active' || building.idleMs === null) return 'active';
  if (building.idleMs < MINUTE_MS) return `idle ${Math.floor(building.idleMs / SECOND_MS)} s`;
  return `idle ${Math.floor(building.idleMs / MINUTE_MS)} min`;
}

function backdropOf(viewBox: string): string {
  const [left = 0, top = 0, width = 0, height = 0] = viewBox.split(' ').map(Number);
  const [right, bottom] = [left + width, top + height];
  return polygonPath([
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ]);
}

function groundOf(layout: KingdomLayout): ScenePart[] {
  const tiles = (cells: readonly Cell[], className: string): ScenePart[] =>
    cells.map((cell) => ({ className, d: polygonPath(cellCorners(cell)) }));
  return [...tiles(layout.paths, 'iso__street'), ...tiles(layout.square, 'kingdom__square')];
}

function itemOf(key: string, cell: Cell, className: string, parts: ScenePart[]): SceneItem {
  return { key, depth: cellDepth(cell), className, parts };
}

function buildingsByName(kingdom: Kingdom): Map<string, KingdomBuilding> {
  return new Map(kingdom.areas.flatMap((area) => area.buildings).map((building) => [building.name, building]));
}

function buildingItems(kingdom: Kingdom, layout: KingdomLayout): SceneItem[] {
  const byName = buildingsByName(kingdom);
  return layout.buildings.flatMap((placed) => {
    const building = byName.get(placed.name);
    if (!building) return [];
    const tint = `iso-tint-${(building.slot % TINT_SLOTS) + 1}`;
    const className = `iso__building ${tint} is-${building.state} kingdom__kind--${building.kind}`;
    const parts = buildingParts(placed.cell, building.kind, building.state);
    return [itemOf(`building:${placed.name}`, placed.cell, className, parts), ...workerItems(placed.name, placed.cell, building)];
  });
}

// One item per worker, keyed by agent id, so a worker arriving or leaving is a transition of its own element.
function workerItems(name: string, cell: Cell, building: KingdomBuilding): SceneItem[] {
  const parts = workerParts(cell, building.workers);
  return building.workers.flatMap((worker, index) => {
    const part = parts[index];
    if (!part) return [];
    const key = `worker:${name}:${worker.agentId}`;
    return [{ key, depth: cellDepth(cell) + WORKER_DEPTH, className: 'kingdom__worker-item', parts: [part] }];
  });
}

function formatPx(value: number): string {
  return `${Math.round(value * 10) / 10}px`;
}

function stepItems(mailman: KingdomMailman, route: readonly Cell[], tip: string): SceneItem[] {
  return walkSteps(route).map((step) => ({
    key: `mailman:${mailman.key}:${step.index}`,
    depth: step.depth,
    className: 'iso__step kingdom__step',
    parts: walkerStepParts(tip),
    vars: {
      '--from-x': formatPx(step.from.x),
      '--from-y': formatPx(step.from.y),
      '--to-x': formatPx(step.to.x),
      '--to-y': formatPx(step.to.y),
      '--step': String(step.index),
    },
  }));
}

// One element per step so each sorts against the buildings it passes, then a resting walker at the end cell until
// the model drops the mailman. A hand-back has no route: it rests at its own building.
function mailmanItems(kingdom: Kingdom, layout: KingdomLayout): SceneItem[] {
  return kingdom.mailmen.flatMap((mailman) => {
    const home = mailman.insideBuilding ?? mailman.from;
    const door = layout.buildings.find((placed) => placed.name === home)?.door;
    if (!door) return [];
    const target = mailman.to === CASTLE_ID ? CASTLE_LABEL : mailman.to;
    const tip = `${mailman.from} → ${target}`;
    const route = walkRoute(mailmanRoute(layout, mailman));
    const end = route[route.length - 1] ?? door;
    const steps = stepItems(mailman, route, tip);
    const rest: SceneItem = {
      key: `mailman:${mailman.key}`,
      depth: cellDepth(end) + MAILMAN_DEPTH,
      className: 'kingdom__walker kingdom__rest',
      parts: mailmanParts(end, tip),
      vars: { '--rest-delay': `${steps.length * STEP_SECONDS}s` },
    };
    return [...steps, rest];
  });
}

function itemsOf(kingdom: Kingdom, layout: KingdomLayout): SceneItem[] {
  const isNeedingYou = kingdom.castle.needsYou;
  const castleClass = isNeedingYou ? 'kingdom__castle is-needs-you' : 'kingdom__castle';
  const keyOf = (prefix: string, cell: Cell): string => `${prefix}:${cell.col},${cell.row}`;
  const items = [
    itemOf('castle', layout.castle, castleClass, castleParts(layout.castle, isNeedingYou)),
    itemOf('well', layout.well, 'kingdom__stone', wellParts(layout.well)),
    itemOf('stall', layout.stall, 'kingdom__stall', stallParts(layout.stall)),
    ...layout.wall.map((cell) => itemOf(keyOf('wall', cell), cell, 'kingdom__stone', wallParts(cell))),
    ...layout.towers.map((cell) => itemOf(keyOf('tower', cell), cell, 'kingdom__stone', towerParts(cell))),
    ...layout.trees.map((cell) => itemOf(keyOf('tree', cell), cell, 'kingdom__tree', treeParts(cell))),
    ...buildingItems(kingdom, layout),
    ...mailmanItems(kingdom, layout),
  ];
  return items.sort((first, second) => first.depth - second.depth);
}

function buildingLabels(kingdom: Kingdom, layout: KingdomLayout): SceneLabel[] {
  const byName = buildingsByName(kingdom);
  return layout.buildings.flatMap((placed) => {
    const building = byName.get(placed.name);
    if (!building) return [];
    const front = isoPoint(placed.cell.col + 1, placed.cell.row + 1);
    const labels: SceneLabel[] = [
      { key: `name:${placed.name}`, className: 'iso__label', x: front.x, y: front.y + NAME_OFFSET, text: nameLabel(placed.name) },
      { key: `status:${placed.name}`, className: 'iso__status', x: front.x, y: front.y + STATUS_OFFSET, text: statusLabel(building) },
    ];
    if (building.moreWorkers > 0) {
      const text = `+${building.moreWorkers} more`;
      labels.push({ key: `more:${placed.name}`, className: 'kingdom__more', x: front.x, y: front.y - WORKER_MORE_OFFSET, text });
    }
    return labels;
  });
}

function areaLabels(kingdom: Kingdom, layout: KingdomLayout): SceneLabel[] {
  const overflowNames = new Set(layout.overflow);
  return layout.areas.flatMap((placed) => {
    const centre = cellCentre(placed.label);
    const text = placed.id === COURT_ID ? COURT_LABEL : placed.id;
    const labels: SceneLabel[] = [
      { key: `area:${placed.id}`, className: 'kingdom__area', x: centre.x, y: centre.y + AREA_LABEL_OFFSET, text },
    ];
    const hiddenCount = kingdom.areas
      .filter((area) => area.id === placed.id)
      .flatMap((area) => area.buildings)
      .filter((building) => overflowNames.has(building.name)).length;
    if (hiddenCount > 0) {
      const tip = `${hiddenCount} more session${hiddenCount === 1 ? '' : 's'} found no free spot here`;
      labels.push({ key: `overflow:${placed.id}`, className: 'kingdom__overflow', x: centre.x, y: centre.y + OVERFLOW_OFFSET, text: `+${hiddenCount}`, tip });
    }
    return labels;
  });
}

function castleLabels(kingdom: Kingdom, layout: KingdomLayout): SceneLabel[] {
  const front = isoPoint(layout.castle.col + 1, layout.castle.row + 1);
  const labels: SceneLabel[] = [
    { key: 'castle-name', className: 'iso__label', x: front.x, y: front.y + NAME_OFFSET, text: CASTLE_LABEL },
  ];
  if (kingdom.castle.needsYou) {
    labels.push({ key: 'castle-status', className: 'iso__status', x: front.x, y: front.y + STATUS_OFFSET, text: 'needs you' });
  }
  return labels;
}

/** Arrange the kingdom and its layout into the three drawing layers. */
export function buildKingdomScene(kingdom: Kingdom, layout: KingdomLayout): KingdomScene {
  return {
    orientation: layout.orientation,
    viewBox: layout.viewBox,
    backdrop: backdropOf(layout.viewBox),
    ground: groundOf(layout),
    items: itemsOf(kingdom, layout),
    labels: [...castleLabels(kingdom, layout), ...buildingLabels(kingdom, layout), ...areaLabels(kingdom, layout)],
  };
}
