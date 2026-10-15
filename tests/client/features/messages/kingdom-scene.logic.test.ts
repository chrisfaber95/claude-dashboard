// Kingdom scene: layers, depth order, state looks, castle banner, overflow sign and the wide/tall choice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COURT_ID } from '../../../../src/client/features/messages/kingdom-grouping.logic.ts';
import { createKingdomLayoutTracker } from '../../../../src/client/features/messages/kingdom-layout.logic.ts';
import {
  buildKingdomScene,
  nameLabel,
  orientationFor,
  statusLabel,
} from '../../../../src/client/features/messages/kingdom-scene.logic.ts';
import type { KingdomScene } from '../../../../src/client/features/messages/kingdom-scene.logic.ts';
import { CASTLE_ID } from '../../../../src/client/features/messages/kingdom-types.logic.ts';
import type { Kingdom, KingdomBuilding } from '../../../../src/client/features/messages/kingdom-types.logic.ts';
import type { BuildingKind } from '../../../../src/client/features/messages/kingdom-grouping.logic.ts';

function building(name: string, overrides: Partial<KingdomBuilding> = {}): KingdomBuilding {
  return { name, kind: 'house', state: 'active', idleMs: null, areaId: COURT_ID, slot: 0, workers: [], moreWorkers: 0, ...overrides };
}

function kingdomOf(buildings: KingdomBuilding[], needsYou = false): Kingdom {
  return { castle: { id: CASTLE_ID, needsYou }, areas: [{ id: COURT_ID, kind: 'court', buildings }], mailmen: [] };
}

function sceneOf(kingdom: Kingdom, orientation: 'wide' | 'tall' = 'wide'): KingdomScene {
  return buildKingdomScene(kingdom, createKingdomLayoutTracker().arrange(kingdom, orientation));
}

function partClasses(scene: KingdomScene, key: string): string[] {
  return scene.items.find((item) => item.key === key)?.parts.map((part) => part.className) ?? [];
}

test('orientationFor is tall only for a measured area that is taller than wide', () => {
  assert.equal(orientationFor(800, 400), 'wide');
  assert.equal(orientationFor(400, 800), 'tall');
  assert.equal(orientationFor(0, 0), 'wide');
  assert.equal(orientationFor(500, 500), 'wide');
});

test('labels: names are shortened and states read without colour', () => {
  assert.equal(nameLabel('eng-claude-dashboard'), 'eng-claude-da…');
  assert.equal(statusLabel({ state: 'active', idleMs: null }), 'active');
  assert.equal(statusLabel({ state: 'idle', idleMs: 12 * 60_000 }), 'idle 12 min');
  assert.equal(statusLabel({ state: 'idle', idleMs: 5000 }), 'idle 5 s');
  assert.equal(statusLabel({ state: 'stopped', idleMs: null }), 'stopped');
});

test('the castle shows its banner exactly when it needs the user', () => {
  assert.ok(partClasses(sceneOf(kingdomOf([building('a')], true)), 'castle').includes('kingdom__flag'));
  assert.ok(!partClasses(sceneOf(kingdomOf([building('a')], false)), 'castle').includes('kingdom__flag'));
});

test('the scene has the square, wall, towers, trees and one item per building, sorted back to front', () => {
  const scene = sceneOf(kingdomOf([building('a'), building('b', { slot: 1 })]));
  const keys = scene.items.map((item) => item.key);
  for (const prefix of ['castle', 'well', 'stall', 'wall:', 'tower:', 'tree:', 'building:a', 'building:b']) {
    assert.ok(keys.some((key) => key.startsWith(prefix)), prefix);
  }
  assert.ok(scene.ground.some((part) => part.className === 'kingdom__square'));
  assert.ok(scene.ground.some((part) => part.className === 'iso__street'));
  const depths = scene.items.map((item) => item.depth);
  assert.deepEqual(depths, [...depths].sort((first, second) => first - second));
});

test('building states: smoke only while active, shutters only while stopped', () => {
  const scene = sceneOf(
    kingdomOf([
      building('live'),
      building('quiet', { state: 'idle', idleMs: 60_000, slot: 1 }),
      building('shut', { state: 'stopped', slot: 2 }),
    ]),
  );
  assert.ok(partClasses(scene, 'building:live').includes('kingdom__smoke'));
  assert.ok(!partClasses(scene, 'building:quiet').includes('kingdom__smoke'));
  assert.ok(!partClasses(scene, 'building:quiet').includes('kingdom__shutter'));
  assert.ok(partClasses(scene, 'building:shut').includes('kingdom__shutter'));
  const labels = scene.labels.map((label) => label.text);
  assert.ok(labels.includes('idle 1 min') && labels.includes('stopped') && labels.includes('active'));
});

test('workers stand at their building and the extra ones become a "+N more" label', () => {
  const worker = { agentId: 'w1', agentType: 'coder', activity: 'editing' };
  const scene = sceneOf(kingdomOf([building('a', { workers: [worker, { ...worker, agentId: 'w2' }], moreWorkers: 3 })]));
  const parts = scene.items.find((item) => item.key === 'building:a')?.parts ?? [];
  assert.equal(parts.filter((part) => part.className === 'kingdom__worker').length, 2);
  assert.ok(scene.labels.some((label) => label.text === '+3 more'));
});

test('the four building kinds have different silhouettes and the hall is the tallest', () => {
  const kinds: BuildingKind[] = ['hall', 'guild', 'workshop', 'house'];
  const shapes = kinds.map((kind) => {
    const scene = sceneOf(kingdomOf([building('x', { kind })]));
    return scene.items.find((item) => item.key === 'building:x')?.parts.map((part) => part.d).join('') ?? '';
  });
  assert.equal(new Set(shapes).size, kinds.length);
  const topOf = (shape: string): number => Math.min(...(shape.match(/-?\d+(\.\d+)? (-?\d+(\.\d+)?)/g) ?? []).map((pair) => Number(pair.split(' ')[1])));
  const [hall, ...others] = shapes.map(topOf);
  assert.ok(hall !== undefined && others.every((top) => hall < top), 'the hall reaches highest on screen');
});

test('buildings that found no spot show as a "+N" sign in their area', () => {
  const crowd = Array.from({ length: 40 }, (_, index) => building(`s${index}`, { slot: index }));
  const scene = sceneOf(kingdomOf(crowd));
  const sign = scene.labels.find((label) => label.className === 'kingdom__overflow');
  assert.ok(sign && /^\+\d+$/.test(sign.text));
});

test('the tall scene keeps the same objects and says so in its orientation', () => {
  const scene = sceneOf(kingdomOf([building('a')]), 'tall');
  assert.equal(scene.orientation, 'tall');
  assert.ok(scene.items.some((item) => item.key === 'building:a'));
  assert.ok(!scene.items.some((item) => item.key.startsWith('tree:')), 'tall has no trees');
});
