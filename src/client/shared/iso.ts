// Pure isometric geometry (no DOM): grid cells to SVG points, face paths and draw order.

/** Width of one ground tile in SVG units; tiles are 2:1, so the height is half. */
export const TILE_WIDTH = 96;
export const TILE_HEIGHT = TILE_WIDTH / 2;

/** A point in SVG units. */
export interface ScreenPoint {
  x: number;
  y: number;
}

/** One ground cell. `col` runs down to the right on screen, `row` down to the left. */
export interface Cell {
  col: number;
  row: number;
}

/** The three visible faces of a box, each as four corners. */
export interface BoxFaces {
  top: readonly ScreenPoint[];
  left: readonly ScreenPoint[];
  right: readonly ScreenPoint[];
}

/** One straight piece of a walk, from one cell centre to the next. */
export interface WalkStep {
  index: number;
  from: ScreenPoint;
  to: ScreenPoint;
  depth: number;
}

/** SVG point of a grid corner, raised by `lift` SVG units (a building's height). */
export function isoPoint(col: number, row: number, lift = 0): ScreenPoint {
  return {
    x: ((col - row) * TILE_WIDTH) / 2,
    y: ((col + row) * TILE_HEIGHT) / 2 - lift,
  };
}

/** The diamond of a cell: back, right, front and left corner. */
export function cellCorners(cell: Cell, lift = 0): ScreenPoint[] {
  return [
    isoPoint(cell.col, cell.row, lift),
    isoPoint(cell.col + 1, cell.row, lift),
    isoPoint(cell.col + 1, cell.row + 1, lift),
    isoPoint(cell.col, cell.row + 1, lift),
  ];
}

/** Centre of a cell on the ground: where walkers stand and labels hang from. */
export function cellCentre(cell: Cell): ScreenPoint {
  return isoPoint(cell.col + 0.5, cell.row + 0.5);
}

/** Visible faces of a box filling one cell, `height` SVG units tall. */
export function isoBox(cell: Cell, height: number): BoxFaces {
  const [, right, front, left] = cellCorners(cell);
  const top = cellCorners(cell, height);
  const [, topRight, topFront, topLeft] = top;
  if (!right || !front || !left || !topRight || !topFront || !topLeft) return { top: [], left: [], right: [] };
  return {
    top,
    left: [topLeft, topFront, front, left],
    right: [topFront, topRight, right, front],
  };
}

/**
 * A patch on a face (window, door, sign): `u` runs along the face's top edge, `v` down from it, both 0..1.
 * Takes the corners in the order `isoBox` returns them.
 */
export function facePatch(face: readonly ScreenPoint[], u0: number, u1: number, v0: number, v1: number): ScreenPoint[] {
  const [origin, alongU, , alongV] = face;
  if (!origin || !alongU || !alongV) return [];
  const at = (along: number, down: number): ScreenPoint => ({
    x: origin.x + along * (alongU.x - origin.x) + down * (alongV.x - origin.x),
    y: origin.y + along * (alongU.y - origin.y) + down * (alongV.y - origin.y),
  });
  return [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
}

/** SVG path data of a closed polygon, rounded to 0.1 so the DOM stays small. */
export function polygonPath(points: readonly ScreenPoint[]): string {
  const round = (value: number): number => Math.round(value * 10) / 10;
  const [first, ...rest] = points;
  if (!first) return '';
  return `M${round(first.x)} ${round(first.y)}${rest.map((point) => `L${round(point.x)} ${round(point.y)}`).join('')}Z`;
}

/** Draw depth of whatever stands on a cell: draw low depths first. */
export function cellDepth(cell: Cell): number {
  return cell.col + cell.row;
}

/**
 * Every cell of a walk through `corners` (start, turns, end). Consecutive corners share a column or a row; the
 * feature's layout picks them so the walk stays on its streets.
 */
export function walkRoute(corners: readonly Cell[]): Cell[] {
  const [start, ...turns] = corners;
  if (!start) return [];
  const route: Cell[] = [start];
  let { col, row } = start;
  for (const turn of turns) {
    while (col !== turn.col || row !== turn.row) {
      if (col === turn.col) row += Math.sign(turn.row - row);
      else col += Math.sign(turn.col - col);
      route.push({ col, row });
    }
  }
  return route;
}

/**
 * A walk cut into one step per cell edge. Each step sorts just before the front-most of its two cells, so it hides
 * behind the buildings in front of it and covers the ones behind it. One SVG element can't do that for a whole
 * walk: a building can be in front of the walker at one end and behind it at the other.
 */
export function walkSteps(route: readonly Cell[]): WalkStep[] {
  return route.slice(1).flatMap((cell, index) => {
    const previous = route[index];
    if (!previous) return [];
    const depth = Math.max(cellDepth(previous), cellDepth(cell)) - 0.5;
    return [{ index, from: cellCentre(previous), to: cellCentre(cell), depth }];
  });
}

/** SVG viewBox that fits every point with `margin` units around it. */
export function fitViewBox(points: readonly ScreenPoint[], margin: number): string {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs) - margin;
  const minY = Math.min(...ys) - margin;
  return `${minX} ${minY} ${Math.max(...xs) + margin - minX} ${Math.max(...ys) + margin - minY}`;
}
