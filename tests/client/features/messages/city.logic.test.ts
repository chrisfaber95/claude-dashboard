// City model: shops, stable slots, postmen and workers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MessageInfo, SessionInfo, SubagentInfo } from '../../../../src/shared/types/index.ts';
import { createCityTracker, POSTMAN_LIFETIME_MS, WORKERS_SHOWN_MAX } from '../../../../src/client/features/messages/city.logic.ts';

const NOW = 10_000_000;
const HOUR = 60 * 60_000;

const session = (name: string, updatedAtMs = NOW): SessionInfo => ({
  sessionId: `id-${name}`, pid: 1, name, project: 'p', cwd: '', status: 'busy', entrypoint: '', kind: '',
  startedAtMs: 0, updatedAtMs, branch: null, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
});
const message = (direction: 'in' | 'out', sessionName: string, peer: string, tsMs: number): MessageInfo => ({
  tsMs, kind: 'session', direction, sessionId: `id-${sessionName}`, sessionName, peer, snippet: '',
});
const subagent = (agentId: string, sessionId: string, state: 'working' | 'done' = 'working'): SubagentInfo => ({
  agentId, sessionId, project: 'p', agentType: 'x', description: '', prompt: '', background: false, parentAgentId: null,
  startedAtMs: 0, lastTsMs: 0, state, handedBack: false, activity: '', result: '', tokens: 0,
});

test('shop states: active, idle with idle time, stopped, and absent after an hour', () => {
  const tracker = createCityTracker();
  const city = tracker.update({
    sessions: [session('a', NOW - 90_000), session('b', NOW - 90_000)],
    messages: [
      message('out', 'a', 'b', NOW - 10_000),
      message('out', 'c', 'a', NOW - 20 * 60_000),
      message('out', 'd', 'a', NOW - HOUR - 1000),
    ],
    subagents: [],
    nowMs: NOW,
  });
  const byName = new Map(city.shops.map((shop) => [shop.name, shop]));
  assert.equal(byName.get('a')?.state, 'active');
  assert.equal(byName.get('b')?.state, 'active');
  assert.equal(byName.get('c')?.state, 'stopped');
  assert.equal(byName.has('d'), false);
  assert.equal(city.shops.length, 3);
});

test('a running session without a recent message is idle with its idle time', () => {
  const city = createCityTracker().update({ sessions: [session('a', NOW - 45_000)], messages: [], subagents: [], nowMs: NOW });
  assert.equal(city.shops[0]?.state, 'idle');
  assert.equal(city.shops[0]?.idleMs, 45_000);
});

test('shops keep their slot while others arrive and leave', () => {
  const tracker = createCityTracker();
  const slots = (names: string[], nowMs: number) =>
    new Map(tracker.update({ sessions: names.map((name) => session(name)), messages: [], subagents: [], nowMs }).shops.map((shop) => [shop.name, shop.slot]));
  const first = slots(['a', 'b', 'c'], NOW);
  const second = slots(['a', 'c', 'd'], NOW + 1000);
  assert.equal(second.get('a'), first.get('a'));
  assert.equal(second.get('c'), first.get('c'));
  assert.equal(second.get('d'), first.get('b'));
  const third = slots(['a', 'c', 'd', 'e'], NOW + 2000);
  assert.equal(third.get('d'), second.get('d'));
  assert.equal(third.get('a'), first.get('a'));
});

test('one postman for the out and in record of a message, gone after 30 s, nothing cumulative', () => {
  const tracker = createCityTracker();
  const sessions = [session('a'), session('b')];
  const messages = [message('out', 'a', 'b', NOW - 1000), message('in', 'b', 'a', NOW - 900)];
  const first = tracker.update({ sessions, messages, subagents: [], nowMs: NOW });
  assert.equal(first.postmen.length, 1);
  assert.equal(first.postmen[0]?.from, 'a');
  assert.equal(first.postmen[0]?.to, 'b');
  const later = tracker.update({ sessions, messages, subagents: [], nowMs: NOW + 2000 });
  assert.equal(later.postmen.length, 1);
  assert.ok((later.postmen[0]?.progress ?? 0) > 0);
  const gone = tracker.update({ sessions, messages, subagents: [], nowMs: NOW + POSTMAN_LIFETIME_MS });
  assert.equal(gone.postmen.length, 0);
  const still = tracker.update({ sessions, messages, subagents: [], nowMs: NOW + POSTMAN_LIFETIME_MS + 2000 });
  assert.equal(still.postmen.length, 0);
});

test('an in record without its out still gets one postman; old messages on opening get none', () => {
  const tracker = createCityTracker();
  const sessions = [session('a'), session('b')];
  const city = tracker.update({
    sessions,
    messages: [message('in', 'b', 'a', NOW - 5000), message('out', 'a', 'b', NOW - 20 * 60_000)],
    subagents: [],
    nowMs: NOW,
  });
  assert.equal(city.postmen.length, 1);
  const next = tracker.update({
    sessions,
    messages: [message('out', 'b', 'a', NOW + 1000), message('in', 'b', 'a', NOW - 5000)],
    subagents: [],
    nowMs: NOW + 2000,
  });
  assert.equal(next.postmen.length, 2);
});

test('a subagent hand-back is a postman inside the parent shop, worker to boss', () => {
  const handBack: MessageInfo = {
    tsMs: NOW - 1000, kind: 'subagent', direction: 'in', sessionId: 'id-a', sessionName: 'a', peer: 'agent-1', snippet: '', agentId: 'agent-1',
  };
  const city = createCityTracker().update({ sessions: [session('a')], messages: [handBack], subagents: [], nowMs: NOW });
  assert.equal(city.postmen.length, 1);
  assert.equal(city.postmen[0]?.insideShop, 'a');
  assert.equal(city.postmen[0]?.from, 'agent-1');
  assert.equal(city.postmen[0]?.to, 'boss');
});

test('working subagents are workers, capped at six with a "+N more" count; done ones are not shown', () => {
  const agents = [...Array(8).keys()].map((index) => subagent(`w${index}`, 'id-a'));
  agents.push(subagent('finished', 'id-a', 'done'), subagent('other', 'id-b'));
  const city = createCityTracker().update({ sessions: [session('a'), session('b')], messages: [], subagents: agents, nowMs: NOW });
  const shop = city.shops.find((candidate) => candidate.name === 'a');
  assert.equal(shop?.workers.length, WORKERS_SHOWN_MAX);
  assert.equal(shop?.moreWorkers, 2);
  assert.equal(city.shops.find((candidate) => candidate.name === 'b')?.workers.length, 1);
});
