import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  TILE_HEIGHT,
  TILE_WIDTH,
  cellCentre,
  cellDepth,
  facePatch,
  fitViewBox,
  isoBox,
  isoPoint,
  polygonPath,
  walkRoute,
  walkSteps,
} from '../../../src/client/shared/iso.ts';

test('isoPoint: a 2:1 diamond; lift moves the point straight up', () => {
  assert.deepEqual(isoPoint(0, 0), { x: 0, y: 0 });
  assert.deepEqual(isoPoint(1, 0), { x: TILE_WIDTH / 2, y: TILE_HEIGHT / 2 });
  assert.deepEqual(isoPoint(0, 1), { x: -TILE_WIDTH / 2, y: TILE_HEIGHT / 2 });
  assert.deepEqual(isoPoint(1, 1, 10), { x: 0, y: TILE_HEIGHT - 10 });
});

test('isoBox: the left and right face share the front edge; the top is lifted by the height', () => {
  const faces = isoBox({ col: 2, row: 1 }, 40);
  assert.deepEqual(faces.left[1], faces.right[0]);
  assert.deepEqual(faces.left[2], faces.right[3]);
  assert.deepEqual(faces.top[2], isoPoint(3, 2, 40));
});

test('facePatch: the full range is the face itself', () => {
  const { right } = isoBox({ col: 0, row: 0 }, 30);
  assert.deepEqual(facePatch(right, 0, 1, 0, 1), right);
});

test('polygonPath rounds to 0.1 and closes the path', () => {
  assert.equal(polygonPath([{ x: 0, y: 0 }, { x: 1.234, y: 2 }, { x: 3, y: 4.56 }]), 'M0 0L1.2 2L3 4.6Z');
  assert.equal(polygonPath([]), '');
});

test('walkRoute: one cell at a time through every corner', () => {
  const route = walkRoute([{ col: 2, row: 2 }, { col: 3, row: 2 }, { col: 3, row: 4 }]);
  assert.deepEqual(route, [{ col: 2, row: 2 }, { col: 3, row: 2 }, { col: 3, row: 3 }, { col: 3, row: 4 }]);
  assert.deepEqual(walkRoute([]), []);
});

test('walkSteps: a step draws after the building behind it and before the one in front', () => {
  const [step] = walkSteps([{ col: 3, row: 3 }, { col: 3, row: 4 }]);
  assert.ok(step);
  assert.deepEqual(step.from, cellCentre({ col: 3, row: 3 }));
  assert.deepEqual(step.to, cellCentre({ col: 3, row: 4 }));
  assert.ok(cellDepth({ col: 2, row: 4 }) < step.depth, 'building on the left of the street is behind');
  assert.ok(cellDepth({ col: 4, row: 3 }) > step.depth, 'building on the right of the street is in front');
});

test('fitViewBox: bounds plus margin', () => {
  assert.equal(fitViewBox([{ x: -10, y: 0 }, { x: 30, y: 20 }], 5), '-15 -5 50 30');
});
