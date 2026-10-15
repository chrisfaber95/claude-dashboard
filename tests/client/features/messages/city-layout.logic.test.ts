// City geometry and labels of the messages popup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CityPostman, CityShop } from '../../../../src/client/features/messages/city.logic.ts';
import {
  CITY_WIDTH,
  ROW_HEIGHT,
  bossPoint,
  cityHeight,
  doorPoint,
  postmanPath,
  shopNameLabel,
  shopStatusLabel,
  workerPoint,
} from '../../../../src/client/features/messages/city-layout.logic.ts';

function makeShop(name: string, column: number, row = 0): CityShop {
  const worker = { agentId: 'agent-1', agentType: 'coder', activity: 'editing' };
  return { name, state: 'active', idleMs: null, slot: column, column, row, workers: [worker], moreWorkers: 0 };
}

const street: CityPostman = { key: 'k1', from: 'alpha', to: 'beta', insideShop: null, progress: 0 };
const handBack: CityPostman = { key: 'k2', from: 'agent-1', to: 'boss', insideShop: 'alpha', progress: 0 };

test('cityHeight grows by one row per shop row and never drops below one row', () => {
  assert.equal(cityHeight([]), ROW_HEIGHT);
  assert.equal(cityHeight([makeShop('a', 0, 2)]), ROW_HEIGHT * 3);
});

test('a street postman walks from the sender door to the receiver door', () => {
  const alpha = makeShop('alpha', 0);
  const beta = makeShop('beta', 2);
  const shops = [alpha, beta];
  const path = postmanPath(street, shops);
  assert.deepEqual(path, { from: doorPoint(alpha), to: doorPoint(beta) });
  assert.ok(path && path.to.x > path.from.x);
});

test('a hand-back postman walks from its worker to the boss inside one shop', () => {
  const alpha = makeShop('alpha', 1);
  const shops = [alpha];
  assert.deepEqual(postmanPath(handBack, shops), { from: workerPoint(alpha, 0), to: bossPoint(alpha) });
});

test('a postman whose shop is not drawn has no path', () => {
  assert.equal(postmanPath(street, [makeShop('alpha', 0)]), null);
  assert.equal(postmanPath(handBack, []), null);
});

test('all shop columns fit inside the city width', () => {
  assert.ok(doorPoint({ column: 3, row: 0 }).x < CITY_WIDTH);
});

test('status labels read active, idle with minutes and stopped', () => {
  assert.equal(shopStatusLabel({ state: 'active', idleMs: null }), 'active');
  assert.equal(shopStatusLabel({ state: 'idle', idleMs: 12 * 60_000 }), 'idle 12 min');
  assert.equal(shopStatusLabel({ state: 'idle', idleMs: 45_000 }), 'idle 45 s');
  assert.equal(shopStatusLabel({ state: 'stopped', idleMs: null }), 'stopped');
});

test('shop names are shortened with an ellipsis', () => {
  assert.equal(shopNameLabel('short'), 'short');
  assert.equal(shopNameLabel('a-very-long-session-name'), 'a-very-long-s…');
});
