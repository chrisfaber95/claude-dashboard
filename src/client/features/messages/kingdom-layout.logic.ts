// Pure layout of the kingdom on the isometric grid (no drawing): castle, square, court, districts, paths, wall and
// trees, in a wide and a tall arrangement, and the cell route of each mailman. Geometry only through shared/iso.ts.
import type { Cell } from '../../shared/iso.ts';
import { cellCorners, fitViewBox, isoPoint } from '../../shared/iso.ts';
import type { ScreenPoint } from '../../shared/iso.ts';
import { cellKey, cornersOf, findWalk, growBy, neighboursOf, ringAround } from './kingdom-grid.logic.ts';
import type {
  KingdomLayout,
  KingdomOrientation,
  KingdomPlan,
  KingdomSection,
  PlacedArea,
  PlacedBuilding,
} from './kingdom-layout-types.logic.ts';
import { planTall } from './kingdom-plan-tall.logic.ts';
import { planWide } from './kingdom-plan-wide.logic.ts';
import { CASTLE_ID } from './kingdom-types.logic.ts';
import type { Kingdom, KingdomMailman } from './kingdom-types.logic.ts';

export type * from './kingdom-layout-types.logic.ts';

/** Room above the top cells for the tallest drawing (the castle), in SVG units. */
const SKY_ALLOWANCE = 120;
const VIEW_MARGIN = 8;
const TOWER_SPACING = 6;
const TREE_SPACING = 5;
const TREE_COLUMN_FACTOR = 31;
const TREE_ROW_FACTOR = 17;

/** Keeps each district on its plot while it is on screen, so no building moves when another one comes or goes. */
export interface KingdomLayoutTracker {
  arrange(kingdom: Kingdom, orientation: KingdomOrientation): KingdomLayout;
}

class LayoutTracker implements KingdomLayoutTracker {
  private readonly plotByArea = new Map<string, number>();

  arrange(kingdom: Kingdom, orientation: KingdomOrientation): KingdomLayout {
    const districts = kingdom.areas.filter((area) => area.kind === 'district');
    this.assignPlots(districts.map((area) => area.id));
    const plotIndices = [...this.plotByArea.values()];
    const court = kingdom.areas.find((area) => area.kind === 'court');
    const courtSize = court ? Math.max(0, ...court.buildings.map((building) => building.slot + 1)) : 0;
    const plan = orientation === 'wide' ? planWide(plotIndices) : planTall(plotIndices, courtSize);
    const placed = kingdom.areas.map((area) => ({ area, section: this.sectionOf(area, plan) }));
    return assemble(orientation, plan, placed);
  }

  private sectionOf(area: Kingdom['areas'][number], plan: KingdomPlan): KingdomSection | undefined {
    if (area.kind === 'court') return plan.court;
    const index = this.plotByArea.get(area.id);
    return index === undefined ? undefined : plan.districts.get(index);
  }

  private assignPlots(areaIds: readonly string[]): void {
    const present = new Set(areaIds);
    for (const id of [...this.plotByArea.keys()]) {
      if (!present.has(id)) this.plotByArea.delete(id);
    }
    for (const id of areaIds) {
      if (this.plotByArea.has(id)) continue;
      const taken = new Set(this.plotByArea.values());
      let index = 0;
      while (taken.has(index)) index++;
      this.plotByArea.set(id, index);
    }
  }
}

/** Create a layout tracker; keep it while the popup is open. */
export function createKingdomLayoutTracker(): KingdomLayoutTracker {
  return new LayoutTracker();
}

interface PlacedAreaInput {
  area: Kingdom['areas'][number];
  section: KingdomSection | undefined;
}

function placeBuildings(placed: readonly PlacedAreaInput[]): { buildings: PlacedBuilding[]; overflow: string[] } {
  const buildings: PlacedBuilding[] = [];
  const overflow: string[] = [];
  for (const { area, section } of placed) {
    for (const building of area.buildings) {
      const spot = section?.spots[building.slot];
      if (spot) buildings.push({ name: building.name, areaId: area.id, cell: spot.cell, door: spot.door });
      else overflow.push(building.name);
    }
  }
  return { buildings, overflow };
}

function isTreeCell(cell: Cell): boolean {
  const mix = cell.col * TREE_COLUMN_FACTOR + cell.row * TREE_ROW_FACTOR + cell.col * cell.row;
  return Math.abs(mix) % TREE_SPACING === 0;
}

function viewBoxOf(cells: readonly Cell[]): string {
  const points: ScreenPoint[] = cells.flatMap((cell) => [...cellCorners(cell), isoPoint(cell.col, cell.row, SKY_ALLOWANCE)]);
  return fitViewBox(points, VIEW_MARGIN);
}

function assemble(
  orientation: KingdomOrientation,
  plan: KingdomPlan,
  placed: readonly PlacedAreaInput[],
): KingdomLayout {
  const region = growBy(plan.footprint, plan.reach, plan.bandSteps);
  const regionKeys = new Set(region.map(cellKey));
  const ring = ringAround(region, plan.reach);
  const isCorner = (cell: Cell): boolean => !neighboursOf(cell, 'diamond').some((next) => regionKeys.has(cellKey(next)));
  const isTower = (cell: Cell): boolean => isCorner(cell) || (cell.col + cell.row) % TOWER_SPACING === 0;
  const occupied = new Set(
    [plan.castle, plan.gate, plan.well, plan.stall, ...plan.squareCells, ...plan.pathCells, ...plan.reservedCells].map(cellKey),
  );
  const { buildings, overflow } = placeBuildings(placed);
  const areas: PlacedArea[] = placed.flatMap(({ area, section }) =>
    section ? [{ id: area.id, kind: area.kind, label: section.label }] : [],
  );
  return {
    orientation,
    castle: plan.castle,
    gate: plan.gate,
    well: plan.well,
    stall: plan.stall,
    square: plan.squareCells,
    paths: [plan.gate, ...plan.pathCells.filter((cell) => cellKey(cell) !== cellKey(plan.gate))],
    areas,
    buildings,
    overflow,
    trees: region.filter((cell) => !occupied.has(cellKey(cell)) && isTreeCell(cell)),
    wall: ring.filter((cell) => !isTower(cell)),
    towers: ring.filter(isTower),
    viewBox: viewBoxOf([...region, ...ring]),
    walkable: new Set([plan.gate, ...plan.squareCells, ...plan.pathCells].map(cellKey)),
  };
}

/** Corner list (start, turns, end) of one mailman's walk, ready for `walkRoute`; empty when there is no walk. */
export function mailmanRoute(
  layout: KingdomLayout,
  mailman: Pick<KingdomMailman, 'from' | 'to' | 'insideBuilding'>,
): Cell[] {
  if (mailman.insideBuilding !== null) return [];
  const doorOf = (name: string): Cell | undefined => layout.buildings.find((building) => building.name === name)?.door;
  const start = doorOf(mailman.from);
  const end = mailman.to === CASTLE_ID ? layout.gate : doorOf(mailman.to);
  if (!start || !end) return [];
  return cornersOf(findWalk(layout.walkable, start, end));
}
