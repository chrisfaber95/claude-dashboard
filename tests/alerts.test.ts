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

// ---- failed sign-in alerts (T-014) ----
const signins = (nowMs = 1) => store.buildAlerts({ sessions: [], limits: limits([]), team: null, nowMs }).items.filter((a) => a.kind === 'signin');
const at = (h: number, m: number, s: number) => new Date(2026, 5, 1, h, m, s).getTime();

test('failed sign-ins update one alert per source address instead of adding new ones', () => {
  reset();
  store.recordFailedSignin('192.168.1.20', at(9, 5, 7));
  store.recordFailedSignin('192.168.1.20', at(9, 5, 9));
  store.recordFailedSignin('192.168.1.20', at(14, 30, 1));
  store.recordFailedSignin('192.168.1.99', at(8, 0, 0));
  const items = signins();
  assert.deepEqual(items.map((a) => a.id).sort(), ['signin:192.168.1.20', 'signin:192.168.1.99']);
  const a = items.find((x) => x.id === 'signin:192.168.1.20')!;
  assert.equal(a.title, 'Failed sign-in');
  assert.equal(a.detail, '192.168.1.20 · 3 failed attempts · last at 14:30:01');
  assert.equal(a.sinceMs, at(14, 30, 1));
  assert.equal(items.find((x) => x.id === 'signin:192.168.1.99')!.detail, '192.168.1.99 · 1 failed attempt · last at 08:00:00');
  // repeated builds do not duplicate and the alert stays until dismissed
  assert.equal(signins(2).length, 2);
  assert.equal(signins(9_999_999_999).length, 2);
});

test('dismissing a sign-in alert hides it, and a new failure from that address opens it again', () => {
  reset();
  store.recordFailedSignin('10.0.0.5', at(10, 0, 0));
  store.recordFailedSignin('10.0.0.5', at(10, 0, 1));
  store.dismissAlert('signin:10.0.0.5');
  assert.deepEqual(signins(), []);
  assert.deepEqual(signins(5), [], 'stays dismissed');
  store.recordFailedSignin('10.0.0.5', at(11, 0, 0));
  const again = signins();
  assert.equal(again.length, 1);
  assert.equal(again[0].detail, '10.0.0.5 · 1 failed attempt · last at 11:00:00', 'fresh record, count starts over');
  // other addresses are untouched by a dismissal
  store.recordFailedSignin('10.0.0.6', at(11, 0, 1));
  store.dismissAlert('signin:10.0.0.5');
  assert.deepEqual(signins().map((a) => a.id), ['signin:10.0.0.6']);
});

test('sign-in failures are in memory only: nothing about them reaches alerts.json', () => {
  reset();
  store.recordFailedSignin('172.16.0.9', at(1, 2, 3));
  store.dismissAlert('signin:172.16.0.9');
  store.dismissAlert('session:s1'); // forces a write
  const text = readFileSync(file, 'utf8');
  assert.ok(!text.includes('signin') && !text.includes('172.16.0.9'), text);
  // a stray signin id in the file is ignored on load
  writeFileSync(file, JSON.stringify({ dismissed: ['signin:172.16.0.9', 'session:s1'], threshold: 80 }));
  reset();
  store.recordFailedSignin('172.16.0.9', at(1, 2, 3));
  assert.equal(signins().length, 1, 'not hidden by the stray id');
  // and a restart forgets the failures
  reset();
  assert.deepEqual(signins(), []);
});

test('at most 50 addresses are kept; the one that failed longest ago is dropped', () => {
  reset();
  for (let i = 0; i < 50; i++) store.recordFailedSignin(`10.1.0.${i}`, 1000 + i);
  assert.equal(signins().length, 50);
  store.recordFailedSignin('10.1.0.0', 5000); // the oldest fails again: now the newest
  store.recordFailedSignin('10.2.0.1', 6000); // a 51st address pushes out 10.1.0.1
  const ids = signins().map((a) => a.id);
  assert.equal(ids.length, 50);
  assert.ok(!ids.includes('signin:10.1.0.1'));
  assert.ok(ids.includes('signin:10.1.0.0') && ids.includes('signin:10.2.0.1') && ids.includes('signin:10.1.0.2'));
  // an update of a known address never evicts anything
  store.recordFailedSignin('10.2.0.1', 7000);
  assert.equal(signins().length, 50);
});

test('addresses are normalised and bounded, and the alert holds no token-like input', () => {
  reset();
  store.recordFailedSignin('::ffff:192.168.1.7', 1);
  store.recordFailedSignin('192.168.1.7', 2);
  store.recordFailedSignin('x'.repeat(500), 3);
  store.recordFailedSignin('', 4);
  const items = signins();
  assert.equal(items.find((a) => a.id === 'signin:192.168.1.7')?.detail.includes('2 failed attempts'), true, 'mapped IPv4 and plain IPv4 are one source');
  assert.ok(items.every((a) => a.id.length <= 'signin:'.length + 64));
  assert.ok(items.some((a) => a.id === 'signin:unknown'));
  // the recorded fields are address, count and time only
  const json = JSON.stringify(items);
  assert.ok(!/token|secret|password/i.test(json), json);
});
