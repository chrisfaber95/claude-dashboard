import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeFixture } from './helpers.ts';
import type { LimitsInfo, SessionInfo, TeamBoard } from '../src/shared/types.ts';

const fx = makeFixture();
const store = await import('../src/server/alerts.ts');
const file = join(fx.dataDir, 'alerts.json');

function session(id: string, status: string): SessionInfo {
  return {
    sessionId: id, pid: 1, name: `name-${id}`, project: 'P', cwd: '', status, entrypoint: '', kind: 'interactive',
    startedAtMs: 1, updatedAtMs: 500, branch: null, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}
function limits(utils: number[], source: LimitsInfo['source'] = 'live'): LimitsInfo {
  return {
    source, fetchedAtMs: 1, error: null, hits: [],
    windows: utils.map((u, i) => ({ key: `w${i}`, label: `Window ${i}`, utilization: u, resetsAtMs: 9000 + i })),
  };
}
function team(ids: string[]): TeamBoard {
  return {
    counts: { backlog: 0, ready: 0, 'in-progress': 0, review: ids.length, done: 0, blocked: 0 },
    active: { inProgress: [], review: ids.map((id) => ({ id, title: `title ${id}` })), blocked: [] },
    needsYou: [],
  };
}
const reset = () => store.resetAlertStore();

test('derives one alert per condition with deterministic ids', () => {
  reset();
  const a = store.deriveAlerts(
    { sessions: [session('s1', 'waiting'), session('s2', 'busy')], limits: limits([79, 80, 95]), team: team(['T-1']), nowMs: 7000 },
    80,
  );
  assert.deepEqual(a.map((x) => x.id), ['session:s1', 'usage:w1', 'usage:w2', 'ticket:T-1']);
  const u = a.find((x) => x.id === 'usage:w2')!;
  assert.equal(u.title, 'Window 2');
  assert.equal(u.detail, '95% used');
  assert.equal(u.resetsAtMs, 9002);
  assert.equal(a[0].sinceMs, 500);
  assert.equal(a[3].title, 'T-1');
  assert.equal(a[3].detail, 'title T-1');
});

test('no duplicates across repeated builds; alerts vanish with their condition', () => {
  reset();
  const input = { sessions: [session('s1', 'waiting')], limits: limits([90]), team: team(['T-1', 'T-1']), nowMs: 1000 };
  const first = store.buildAlerts(input);
  const second = store.buildAlerts({ ...input, nowMs: 2000 });
  assert.equal(first.items.length, 3);
  assert.deepEqual(second.items.map((x) => x.id), first.items.map((x) => x.id));
  assert.equal(second.items.find((x) => x.id === 'usage:w0')!.sinceMs, 1000);
  const gone = store.buildAlerts({ sessions: [session('s1', 'busy')], limits: limits([10]), team: team([]), nowMs: 3000 });
  assert.deepEqual(gone.items, []);
});

test('dismissed ids are hidden, cleared when the condition goes, and persisted', () => {
  reset();
  const on = { sessions: [session('s1', 'waiting')], limits: limits([]), team: null, nowMs: 1 };
  store.buildAlerts(on);
  store.dismissAlert('session:s1');
  assert.deepEqual(store.buildAlerts(on).items, []);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).dismissed, ['session:s1']);

  // restart: state comes back from the file
  reset();
  assert.deepEqual(store.buildAlerts(on).items, []);

  // condition clears -> dismissal dropped -> a repeat alerts again
  store.buildAlerts({ ...on, sessions: [session('s1', 'busy')] });
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).dismissed, []);
  assert.equal(store.buildAlerts(on).items.length, 1);
});

test('usage dismissals survive while limits are unavailable', () => {
  reset();
  store.dismissAlert('usage:w0');
  store.dismissAlert('session:gone');
  const out = store.buildAlerts({ sessions: [], limits: limits([], 'none'), team: null, nowMs: 1 });
  assert.deepEqual(out.items, []);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).dismissed, ['usage:w0']);
  // limits are back and the window is below the threshold: now it clears
  store.buildAlerts({ sessions: [], limits: limits([5]), team: null, nowMs: 2 });
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).dismissed, []);
});

test('threshold: default 80, validated, persisted', () => {
  reset();
  writeFileSync(file, JSON.stringify({ dismissed: [], threshold: 80 }));
  assert.equal(store.alertThreshold(), 80);
  assert.equal(store.setAlertThreshold(0), false);
  assert.equal(store.setAlertThreshold(101), false);
  assert.equal(store.setAlertThreshold(50.5), false);
  assert.equal(store.setAlertThreshold(60), true);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).threshold, 60);
  reset();
  assert.equal(store.alertThreshold(), 60);
  const out = store.buildAlerts({ sessions: [], limits: limits([59, 60]), team: null, nowMs: 1 });
  assert.equal(out.threshold, 60);
  assert.deepEqual(out.items.map((x) => x.id), ['usage:w1']);
});

test('missing or corrupt file falls back to defaults', () => {
  mkdirSync(fx.dataDir, { recursive: true });
  const on = { sessions: [session('s1', 'waiting')], limits: limits([]), team: null, nowMs: 1 };
  for (const content of ['{not json', '{"dismissed":"x","threshold":500}', '[]']) {
    reset();
    writeFileSync(file, content);
    assert.equal(store.alertThreshold(), 80);
    assert.equal(store.buildAlerts(on).items.length, 1);
  }
  rmSync(file);
  reset();
  assert.equal(store.alertThreshold(), 80);
  assert.equal(store.buildAlerts(on).items.length, 1);
});

test('the file is only written when something changed', () => {
  reset();
  store.dismissAlert('session:s1');
  const sentinel = readFileSync(file, 'utf8') + ' ';
  writeFileSync(file, sentinel); // a rewrite would remove the trailing space
  store.dismissAlert('session:s1');
  store.setAlertThreshold(80);
  store.buildAlerts({ sessions: [session('s1', 'waiting')], limits: limits([]), team: null, nowMs: 1 });
  assert.equal(readFileSync(file, 'utf8'), sentinel);
});
