# Isometric scenes (2.5D)

Game-like scenes in the dashboard (the old SimCity look: buildings on a diamond grid, people walking the streets) are
isometric SVG drawn from code. No WebGL, no Three.js, no image files. SVG keeps the scene crisp at every size, follows
the theme and skin tokens, and costs no CPU while nothing moves.

Reference picture: `docs/isometric-example.svg` (open it in a browser; the postman walks once). It was generated with
the helpers below.

Read `docs/motion.md` too: every rule there applies to scenes.

## Parts

| File | What |
| --- | --- |
| `src/client/shared/iso.ts` | Pure geometry: cell to SVG point, building faces, patches on faces, walk steps, draw depth. Tested in `tests/client/shared/iso.test.ts`. |
| `src/client/shared/_iso.scss` | Shared look: ground, lit faces, tints, walker steps, labels. Loaded once from `style.scss`. |
| `<feature>.logic.ts` | The feature's layout: which building stands on which cell, where the streets are, the corners of each walk. |
| `<feature>-view.vue` | Binds the computed paths. No geometry in the template. |

## Grid and coordinates

- A scene is a grid of cells `{ col, row }`. `col` runs down to the right on screen, `row` down to the left. Cell
  `(0, 0)` is the back corner.
- Tiles are 2:1 diamonds, `TILE_WIDTH` 96 by `TILE_HEIGHT` 48 SVG units. Scale the whole scene with the SVG `viewBox`
  (`fitViewBox`), never by changing the tile size per feature.
- `isoPoint(col, row, lift)` maps a grid corner to SVG units; `lift` raises it straight up (a roof is the cell's
  corners lifted by the building's height). `cellCentre(cell)` is where walkers stand and labels hang from.
- One building fills exactly one cell. Make a building important by making it taller, not wider: a building over
  several cells breaks the draw order below. If you really need a big one, draw it as one box per cell.

## Drawing a building

`isoBox(cell, height)` returns the three visible faces (`top`, `left`, `right`), four corners each. Turn any of them
into path data with `polygonPath`.

Details sit on a face with `facePatch(face, u0, u1, v0, v1)`: `u` runs along the face's top edge, `v` down from it,
both 0 to 1. So a door in the middle of the left face is `facePatch(faces.left, 0.38, 0.62, 0.55, 1)`, a row of
windows is a few patches on `faces.right` with `v` 0.22 to 0.5, an awning is a thin patch above the door. The patch
follows the face's slant, so it always looks painted on.

## Light and colour

- Light comes from the back left, for every object in every scene: top face lightest, left face the base colour,
  right face darkest. `_iso.scss` does this from one colour per building: set it with `iso-tint-N` (the chart series
  `--s1..--s8`), and the face classes mix `currentColor` with white or black.
- Show a state with a class on the building group, not with new colours: `is-idle` turns the windows off, `is-stopped`
  turns the building grey. Add a state the same way: one class, defined in `_iso.scss`.
- Ground and labels use the theme tokens (`--surface`, `--ink`, `--border`), so light, dark and the skins work
  without extra rules. Check a new scene in light and dark before handing off.
- Labels get a halo in the surface colour (`paint-order: stroke`), so they stay readable over buildings.

## Draw order

SVG paints in document order, so the template has three layers, in this order:

1. **Ground**: every tile, any order.
2. **Scene**: buildings and walk steps in one list, sorted by `depth` (low first). A building's depth is
   `cellDepth(cell)` (`col + row`).
3. **Labels**: all names and status lines, last, so no building ever covers a label.

A moving walker can't be one element. On its way it passes in front of some buildings and behind others, and a
building can be in front of it at one end of the walk and behind it at the other, so no single place in the list is
right. `walkSteps(walkRoute(corners))` cuts the walk into one step per cell edge, and each step has its own depth
(just before the front-most of its two cells). Each step is its own element, sorted into the scene list with the
buildings, and visible only during its part of the walk. `iso.test.ts` pins this: a step sorts after the building on
the far side of its street and before the one on the near side.

## Walking

- The feature's layout gives a walk as corners: start, every turn, end. Consecutive corners share a column or a row,
  and the layout picks them so the walk stays on its streets. `walkRoute` fills in every cell between them.
- A step is an element with classes `iso__step iso-step--<index>` and its two end points as custom properties
  (`--from-x`, `--from-y`, `--to-x`, `--to-y`) in `:style`, the same pattern as the postmen in
  `features/messages/city-view.vue`. Everything else (duration, delay, colour) is a class in `_iso.scss`.
- `.iso__step` is hidden (`opacity: 0`) except while its own keyframes run. The delay class starts step N when step
  N - 1 ends (`--iso-step-duration`, 0.9 s per cell), so the steps read as one walker. `_iso.scss` has delay classes
  for 24 steps; a walk that needs more is too long for a dashboard scene.
- Keys must not change during the walk (`<walker key>:<step index>`), or Vue recreates the elements and the walk
  restarts on the next state push.
- When the walk is over, the feature's logic drops the walker, so no element stays behind (the T-091 rule: no running
  animation once nothing moves). Nothing in a scene loops forever; see `docs/motion.md` for the rare exception.

## Starting point for a scene component

This compiles and lints against the repo rules (no `as`, typed returns, geometry outside the template):

```vue
<script setup lang="ts">
import { computed } from 'vue';
import type { Cell, WalkStep } from '../../shared/iso.ts';
import { cellCentre, cellCorners, cellDepth, facePatch, fitViewBox, isoBox, polygonPath, walkRoute, walkSteps } from '../../shared/iso.ts';

const TINT_SLOTS = 8;
const LABEL_OFFSET = 12;

interface Building extends Cell {
  name: string;
  state: 'active' | 'idle' | 'stopped';
  slot: number;
  height: number;
}

interface Walker {
  key: string;
  corners: readonly Cell[];
}

interface BuildingShape {
  kind: 'building';
  key: string;
  depth: number;
  tint: string;
  state: string;
  left: string;
  right: string;
  top: string;
  door: string;
}

interface StepShape {
  kind: 'step';
  key: string;
  depth: number;
  delay: string;
  vars: Record<string, string>;
}

const props = defineProps<{ cols: number; rows: number; buildings: readonly Building[]; walkers: readonly Walker[] }>();

const ground = computed(() =>
  Array.from({ length: props.cols * props.rows }, (_, index) => {
    const cell = { col: index % props.cols, row: Math.floor(index / props.cols) };
    return { key: `${cell.col},${cell.row}`, path: polygonPath(cellCorners(cell)) };
  }),
);

function buildingShape(building: Building): BuildingShape {
  const faces = isoBox(building, building.height);
  return {
    kind: 'building',
    key: building.name,
    depth: cellDepth(building),
    tint: `iso-tint-${(building.slot % TINT_SLOTS) + 1}`,
    state: `is-${building.state}`,
    left: polygonPath(faces.left),
    right: polygonPath(faces.right),
    top: polygonPath(faces.top),
    door: polygonPath(facePatch(faces.left, 0.38, 0.62, 0.55, 1)),
  };
}

function stepShape(walker: Walker, step: WalkStep): StepShape {
  const vars = {
    '--from-x': `${step.from.x}px`,
    '--from-y': `${step.from.y}px`,
    '--to-x': `${step.to.x}px`,
    '--to-y': `${step.to.y}px`,
  };
  return { kind: 'step', key: `${walker.key}:${step.index}`, depth: step.depth, delay: `iso-step--${step.index}`, vars };
}

// Buildings and walk steps in one list, back to front: SVG paints in document order.
const scene = computed((): (BuildingShape | StepShape)[] =>
  [
    ...props.buildings.map(buildingShape),
    ...props.walkers.flatMap((walker) => walkSteps(walkRoute(walker.corners)).map((step) => stepShape(walker, step))),
  ].sort((first, second) => first.depth - second.depth),
);

const labels = computed(() =>
  props.buildings.map((building) => ({ key: building.name, name: building.name, at: cellCentre(building) })),
);

const viewBox = computed(() =>
  fitViewBox(
    [{ col: 0, row: 0 }, { col: props.cols, row: 0 }, { col: props.cols, row: props.rows }, { col: 0, row: props.rows }].flatMap(
      (corner) => cellCorners(corner),
    ),
    16,
  ),
);
</script>

<template>
  <svg class="iso" :viewBox="viewBox" role="img" aria-label="Sessions as buildings">
    <g class="iso__ground">
      <path v-for="tile in ground" :key="tile.key" class="iso__grass" :d="tile.path" />
    </g>
    <g class="iso__scene">
      <template v-for="item in scene" :key="item.key">
        <g v-if="item.kind === 'building'" :class="['iso__building', item.tint, item.state]">
          <path class="iso__face--left" :d="item.left" />
          <path class="iso__face--right" :d="item.right" />
          <path class="iso__face--top" :d="item.top" />
          <path class="iso__door" :d="item.door" />
        </g>
        <g v-else :class="['iso__step', item.delay]" :style="item.vars">
          <circle cy="-11" r="6" />
        </g>
      </template>
    </g>
    <g class="iso__labels">
      <text v-for="label in labels" :key="label.key" class="iso__label" :x="label.at.x" :y="label.at.y + LABEL_OFFSET">{{ label.name }}</text>
    </g>
  </svg>
</template>
```

In a real feature the building and walker lists come from the feature's `.logic.ts` (pure, `node:test`), and the
shape functions move there too once the component passes the size limits in `docs/code-style.md`.

## Art beyond code

Draw with code first: boxes, patches and a few circles carry the look. Sprite art (for example the CC0 isometric city
packs from kenney.nl) is a product decision, not an engineer's: ask in the ticket. If it is approved, the files are
same-origin under `src/client/`, with their licence next to them, and any SVG passes `checkSvg` (see "UI conventions"
in `docs/architecture.md`). Never load art from a CDN; the CSP blocks it.

## Checklist for a new scene

- Layout and walk corners in `<feature>.logic.ts`, with tests; geometry only through `shared/iso.ts`.
- Three layers: ground, depth-sorted scene, labels.
- One building per cell; states as classes; tints from `iso-tint-N`.
- Walkers as steps; stable keys; dropped by the logic when the walk ends.
- Looks right in light and dark, and at 390 px wide (the SVG scales with its `viewBox`).
- Adds a moving part? Measure with `scripts/measure-cpu.mjs` (`docs/perf.md`) with the scene open, before and after.
