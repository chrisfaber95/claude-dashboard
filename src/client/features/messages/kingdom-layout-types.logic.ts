// Shapes of the kingdom layout: the plan of one arrangement and the placed result the view draws.
import type { Cell } from '../../shared/iso.ts';
import type { KingdomArea } from './kingdom-types.logic.ts';

/** Wide for a desktop popup, tall for a phone. */
export type KingdomOrientation = 'wide' | 'tall';

/** How far the wall reaches around a region: `square` includes the corner cells, `diamond` does not. */
export type WallReach = 'square' | 'diamond';

/** One cell a building may stand on and the path or square cell its door opens to. */
export interface KingdomSpot {
  cell: Cell;
  door: Cell;
}

/** The spots of the court or of one district, in slot order, and the cell its name hangs from. */
export interface KingdomSection {
  spots: KingdomSpot[];
  label: Cell;
}

/** Fixed cells and sections of one arrangement for the plots and court size in use. */
export interface KingdomPlan {
  castle: Cell;
  gate: Cell;
  well: Cell;
  stall: Cell;
  squareCells: Cell[];
  pathCells: Cell[];
  court: KingdomSection;
  /** Sections by plot index. */
  districts: Map<number, KingdomSection>;
  /** Every spot cell of the sections in use, taken or free: nothing else may be drawn there. */
  reservedCells: Cell[];
  /** Everything inside the wall, before the grass band. */
  footprint: Cell[];
  bandSteps: number;
  reach: WallReach;
}

/** A building on its cell. */
export interface PlacedBuilding {
  name: string;
  areaId: string;
  cell: Cell;
  door: Cell;
}

/** The court or a district with the cell its name hangs from. */
export interface PlacedArea {
  id: string;
  kind: KingdomArea['kind'];
  label: Cell;
}

/** The kingdom on the grid: no drawing, only cells. */
export interface KingdomLayout {
  orientation: KingdomOrientation;
  castle: Cell;
  gate: Cell;
  well: Cell;
  stall: Cell;
  square: Cell[];
  paths: Cell[];
  areas: PlacedArea[];
  buildings: PlacedBuilding[];
  /** Names of buildings that found no free spot in their court or district. */
  overflow: string[];
  trees: Cell[];
  wall: Cell[];
  towers: Cell[];
  viewBox: string;
  /** Keys (`col,row`) of every cell a walker may cross: the gate, the square and the paths. */
  walkable: ReadonlySet<string>;
}
