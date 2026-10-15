// Wide plan of the kingdom: castle, square and court in a central block, districts on plots of a street lattice.
import type { Cell } from '../../shared/iso.ts';
import { isoPoint } from '../../shared/iso.ts';
import type { ScreenPoint } from '../../shared/iso.ts';
import { cellKey } from './kingdom-grid.logic.ts';
import type { KingdomPlan, KingdomSection, KingdomSpot } from './kingdom-layout-types.logic.ts';

const LANE_COLUMNS = 7;
const LANE_ROWS = 4;
const PLOT_COLUMNS = 6;
const PLOT_COLUMN_RANGE = 3;
const PLOT_ROW_FIRST = -3;
const PLOT_ROW_LAST = 2;
/** Plot rows -1 and 0 of plot column 0 are the central block. */
const BLOCK_FIRST_ROW = -1;
const BLOCK_LAST_ROW = 0;
/** A plot's street is its second cell row; its label hangs from the third street cell. */
const STREET_ROW_OFFSET = 2;
const LABEL_COLUMN_OFFSET = 2;
const WIDE_BAND_STEPS = 2;
const VERTICAL_WEIGHT = 2;

const CASTLE: Cell = { col: 1, row: 0 };
const GATE: Cell = { col: 2, row: 0 };
const WELL: Cell = { col: 4, row: 0 };
const STALL: Cell = { col: 5, row: 1 };
const COURT_LABEL: Cell = { col: 4, row: -1 };
const SQUARE_FIRST_COLUMN = 3;
const SQUARE_LAST_COLUMN = 5;
const SQUARE_FIRST_ROW = -1;
const SQUARE_LAST_ROW = 1;

interface PlotCoord {
  column: number;
  row: number;
}

function spotAt(col: number, row: number, doorCol: number, doorRow: number): KingdomSpot {
  return { cell: { col, row }, door: { col: doorCol, row: doorRow } };
}

function rangeOf(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

function squareCells(): Cell[] {
  const skipped = new Set([cellKey(WELL), cellKey(STALL)]);
  return rangeOf(SQUARE_FIRST_COLUMN, SQUARE_LAST_COLUMN)
    .flatMap((col) => rangeOf(SQUARE_FIRST_ROW, SQUARE_LAST_ROW).map((row) => ({ col, row })))
    .filter((cell) => !skipped.has(cellKey(cell)));
}

/** Court spots, nearest to the square first; every door is a square or lane cell. */
const COURT_SPOTS: readonly KingdomSpot[] = [
  ...[3, 4, 5].map((col) => spotAt(col, -2, col, -1)),
  spotAt(2, -1, 3, -1),
  spotAt(2, 1, 3, 1),
  spotAt(6, -1, 5, -1),
  spotAt(3, 2, 3, 1),
  spotAt(4, 2, 4, 1),
  ...rangeOf(1, 6).map((col) => spotAt(col, -3, col, -4)),
  ...rangeOf(1, 6).map((col) => spotAt(col, 3, col, 4)),
];

function plotCentre(plot: PlotCoord): ScreenPoint {
  return isoPoint(plot.column * LANE_COLUMNS + LANE_COLUMNS / 2, plot.row * LANE_ROWS + LANE_ROWS / 2);
}

/** Plots ordered by screen distance from the central block, so the scene fills out sideways first. */
function buildPlotOrder(): PlotCoord[] {
  const origin = plotCentre({ column: 0, row: BLOCK_FIRST_ROW });
  const distance = (plot: PlotCoord): number => {
    const centre = plotCentre(plot);
    return (centre.x - origin.x) ** 2 + (VERTICAL_WEIGHT * (centre.y - origin.y)) ** 2;
  };
  return rangeOf(-PLOT_COLUMN_RANGE, PLOT_COLUMN_RANGE)
    .flatMap((column) => rangeOf(PLOT_ROW_FIRST, PLOT_ROW_LAST).map((row) => ({ column, row })))
    .filter((plot) => !(plot.column === 0 && plot.row >= BLOCK_FIRST_ROW && plot.row <= BLOCK_LAST_ROW))
    .sort((a, b) => distance(a) - distance(b) || a.column - b.column || a.row - b.row);
}

const PLOT_ORDER: readonly PlotCoord[] = buildPlotOrder();

/** How many districts the wide arrangement has room for. */
export const WIDE_DISTRICT_CAPACITY = PLOT_ORDER.length;

function plotSection(plot: PlotCoord): KingdomSection {
  const firstColumn = plot.column * LANE_COLUMNS + 1;
  const streetRow = plot.row * LANE_ROWS + STREET_ROW_OFFSET;
  const spots = Array.from({ length: PLOT_COLUMNS * 2 }, (_, slot) => {
    const col = firstColumn + Math.floor(slot / 2);
    return spotAt(col, slot % 2 === 0 ? streetRow - 1 : streetRow + 1, col, streetRow);
  });
  return { spots, label: { col: firstColumn + LABEL_COLUMN_OFFSET, row: streetRow } };
}

function streetCells(plot: PlotCoord): Cell[] {
  const firstColumn = plot.column * LANE_COLUMNS + 1;
  const row = plot.row * LANE_ROWS + STREET_ROW_OFFSET;
  return rangeOf(firstColumn, firstColumn + PLOT_COLUMNS - 1).map((col) => ({ col, row }));
}

interface Bounds {
  firstColumn: number;
  lastColumn: number;
  firstRow: number;
  lastRow: number;
}

function boundsOf(plots: readonly PlotCoord[]): Bounds {
  const columns = [0, ...plots.map((plot) => plot.column)];
  const rows = [BLOCK_FIRST_ROW, BLOCK_LAST_ROW, ...plots.map((plot) => plot.row)];
  return {
    firstColumn: Math.min(...columns) * LANE_COLUMNS,
    lastColumn: (Math.max(...columns) + 1) * LANE_COLUMNS,
    firstRow: Math.min(...rows) * LANE_ROWS,
    lastRow: (Math.max(...rows) + 1) * LANE_ROWS,
  };
}

function isPlotInside(plot: PlotCoord, bounds: Bounds): boolean {
  const left = plot.column * LANE_COLUMNS;
  const top = plot.row * LANE_ROWS;
  return (
    left >= bounds.firstColumn &&
    left + LANE_COLUMNS <= bounds.lastColumn &&
    top >= bounds.firstRow &&
    top + LANE_ROWS <= bounds.lastRow
  );
}

/** The plan for the districts on these plot indices (indices past the capacity are ignored). */
export function planWide(plotIndices: readonly number[]): KingdomPlan {
  const used = plotIndices.flatMap((index) => {
    const plot = PLOT_ORDER[index];
    return plot ? [{ index, plot }] : [];
  });
  const bounds = boundsOf(used.map((entry) => entry.plot));
  const footprint = rangeOf(bounds.firstColumn, bounds.lastColumn).flatMap((col) =>
    rangeOf(bounds.firstRow, bounds.lastRow).map((row) => ({ col, row })),
  );
  const lanes = footprint.filter((cell) => cell.col % LANE_COLUMNS === 0 || cell.row % LANE_ROWS === 0);
  const square = squareCells();
  const blocked = new Set([CASTLE, WELL, STALL, ...square].map(cellKey));
  const plotSpots = PLOT_ORDER.filter((plot) => isPlotInside(plot, bounds)).flatMap((plot) => plotSection(plot).spots);
  return {
    castle: CASTLE,
    gate: GATE,
    well: WELL,
    stall: STALL,
    squareCells: square,
    pathCells: [...lanes, ...used.flatMap((entry) => streetCells(entry.plot))].filter((cell) => !blocked.has(cellKey(cell))),
    court: { spots: [...COURT_SPOTS], label: COURT_LABEL },
    districts: new Map(used.map((entry) => [entry.index, plotSection(entry.plot)])),
    reservedCells: [...COURT_SPOTS, ...plotSpots].map((spot) => spot.cell),
    footprint,
    bandSteps: WIDE_BAND_STEPS,
    reach: 'square',
  };
}
