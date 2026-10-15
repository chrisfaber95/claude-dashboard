// Tall plan of the kingdom: castle on top, then one staircase street down the screen with the court and the
// districts as sections of it. The staircase keeps the scene only a few cells wide, so a phone can show it.
import type { Cell } from '../../shared/iso.ts';
import type { KingdomPlan, KingdomSection, KingdomSpot } from './kingdom-layout-types.logic.ts';

const COURT_FIRST_STEP = 1;
const COURT_STEPS = 10;
const DISTRICT_STEPS = 6;
/** One street step without buildings between two sections. */
const SECTION_GAP_STEPS = 1;
const FIRST_DISTRICT_STEP = COURT_FIRST_STEP + COURT_STEPS + SECTION_GAP_STEPS;
/** Street cells before this index belong to the square. */
const SQUARE_STREET_CELLS = 3;
const LABEL_STEP_OFFSET = 2;

const CASTLE: Cell = { col: -1, row: -1 };
const GATE: Cell = { col: 0, row: -1 };
const WELL: Cell = { col: 0, row: 1 };
const STALL: Cell = { col: 2, row: 0 };

/** Cell `index` of the street: (0,0), (1,0), (1,1), (2,1), (2,2) and so on. */
function streetCell(index: number): Cell {
  const step = Math.floor(index / 2);
  return { col: index % 2 === 0 ? step : step + 1, row: step };
}

function streetCellsUpTo(lastStep: number): Cell[] {
  return Array.from({ length: 2 * lastStep + 2 }, (_, index) => streetCell(index));
}

/** Two spots per street step: the left one below the step's first cell, the right one beside its second. */
function sectionSpots(firstStep: number, steps: number): KingdomSpot[] {
  return Array.from({ length: steps * 2 }, (_, slot) => {
    const step = firstStep + Math.floor(slot / 2);
    if (slot % 2 === 0) return { cell: { col: step, row: step + 1 }, door: { col: step, row: step } };
    return { cell: { col: step + 2, row: step }, door: { col: step + 1, row: step } };
  });
}

function districtFirstStep(plotIndex: number): number {
  return FIRST_DISTRICT_STEP + plotIndex * (DISTRICT_STEPS + SECTION_GAP_STEPS);
}

function districtSection(plotIndex: number): KingdomSection {
  const firstStep = districtFirstStep(plotIndex);
  const labelStep = firstStep + LABEL_STEP_OFFSET;
  return { spots: sectionSpots(firstStep, DISTRICT_STEPS), label: { col: labelStep, row: labelStep } };
}

/** The plan for the districts on these plot indices and a court holding `courtSize` slots. */
export function planTall(plotIndices: readonly number[], courtSize: number): KingdomPlan {
  const courtLastStep = courtSize > 0 ? COURT_FIRST_STEP + Math.ceil(courtSize / 2) - 1 : COURT_FIRST_STEP;
  const lastStep = Math.max(
    COURT_FIRST_STEP,
    Math.min(courtLastStep, COURT_FIRST_STEP + COURT_STEPS - 1),
    ...plotIndices.map((index) => districtFirstStep(index) + DISTRICT_STEPS - 1),
  );
  const courtSteps = Math.min(COURT_STEPS, lastStep - COURT_FIRST_STEP + 1);
  const courtSpots = sectionSpots(COURT_FIRST_STEP, courtSteps);
  const districts = new Map(plotIndices.map((index) => [index, districtSection(index)]));
  const street = streetCellsUpTo(lastStep);
  const squareCells = street.slice(0, SQUARE_STREET_CELLS);
  const pathCells = [GATE, ...street.slice(SQUARE_STREET_CELLS)];
  const reservedCells = [...courtSpots, ...[...districts.values()].flatMap((section) => section.spots)].map((spot) => spot.cell);
  const courtLabelStep = COURT_FIRST_STEP + Math.floor(courtSteps / 2);
  return {
    castle: CASTLE,
    gate: GATE,
    well: WELL,
    stall: STALL,
    squareCells,
    pathCells,
    court: { spots: courtSpots, label: { col: courtLabelStep, row: courtLabelStep } },
    districts,
    reservedCells,
    footprint: [CASTLE, WELL, STALL, ...squareCells, ...pathCells, ...reservedCells],
    bandSteps: 0,
    reach: 'diamond',
  };
}
