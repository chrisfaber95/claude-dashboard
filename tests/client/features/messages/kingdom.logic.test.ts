// Kingdom model: castle, court and districts, buildings, stable slots, mailmen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Alert, MessageInfo, PermissionRequestInfo, SessionInfo, SubagentInfo } from '../../../../src/shared/types/index.ts';
import {
  CASTLE_ID,
  MAILMAN_LIFETIME_MS,
  WORKERS_SHOWN_MAX,
  createKingdomTracker,
} from '../../../../src/client/features/messages/kingdom.logic.ts';
import type { Kingdom, KingdomBuilding, KingdomInput } from '../../../../src/client/features/messages/kingdom.logic.ts';
import { areaIdOf, buildingKindOf } from '../../../../src/client/features/messages/kingdom-grouping.logic.ts';

const NOW = 10_000_000;
const HOUR = 60 * 60_000;

const session = (name: string, project = 'p', updatedAtMs = NOW): SessionInfo => ({
  sessionId: `id-${name}`, pid: 1, name, project, cwd: '', status: 'busy', entrypoint: '', kind: '',
  startedAtMs: 0, updatedAtMs, branch: null, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
});
const message = (direction: 'in' | 'out', sessionName: string, peer: string, tsMs: number): MessageInfo => ({
  tsMs, kind: 'session', direction, sessionId: `id-${sessionName}`, sessionName, peer, snippet: '',
});
const subagent = (agentId: string, sessionId: string, state: 'working' | 'done' = 'working'): SubagentInfo => ({
  agentId, sessionId, project: 'p', agentType: 'x', description: '', prompt: '', background: false, parentAgentId: null,
  startedAtMs: 0, lastTsMs: 0, state, handedBack: false, activity: '', result: '', tokens: 0,
});
const alert = (id: string): Alert => ({ id, kind: 'session', title: '', detail: '', sinceMs: NOW, resetsAtMs: null });
const permission = (id: string, sessionName: string, status: 'pending' | 'expired' = 'pending'): PermissionRequestInfo => ({
  id, sessionId: `id-${sessionName}`, tool: 'Bash', text: '', createdMs: NOW, status,
});

function input(overrides: Partial<KingdomInput>): KingdomInput {
  return { sessions: [], messages: [], subagents: [], alerts: [], permissions: [], nowMs: NOW, ...overrides };
}
const buildingsOf = (kingdom: Kingdom): KingdomBuilding[] => kingdom.areas.flatMap((area) => area.buildings);
const findBuilding = (kingdom: Kingdom, name: string): KingdomBuilding | undefined =>
  buildingsOf(kingdom).find((building) => building.name === name);

test('castle needs you for an alert or a pending permission, not for an expired one alone', () => {
  const tracker = createKingdomTracker();
  assert.equal(tracker.update(input({})).castle.needsYou, false);
  assert.equal(tracker.update(input({ alerts: [alert('usage:5h')] })).castle.needsYou, true);
  assert.equal(tracker.update(input({ permissions: [permission('p1', 'a')] })).castle.needsYou, true);
  assert.equal(tracker.update(input({ permissions: [permission('p1', 'a', 'expired')] })).castle.needsYou, false);
  assert.equal(tracker.update(input({})).castle.id, CASTLE_ID);
});

test('grouping: team-hq project and role names go to the court, other sessions to their project district', () => {
  const names = ['lead', 'designer', 'reviewer', 'reviewer-2', 'eng-claude-dashboard'];
  for (const name of names) assert.equal(areaIdOf(name, 'claude-dashboard'), '@court');
  assert.equal(areaIdOf('anything', 'team-hq'), '@court');
  assert.equal(areaIdOf('worker', 'claude-dashboard'), 'claude-dashboard');
  assert.equal(areaIdOf('worker', null), 'other');
  assert.equal(areaIdOf('lead', null), '@court');
});

test('building kinds: hall, workshop, guild, house', () => {
  assert.equal(buildingKindOf('lead'), 'hall');
  assert.equal(buildingKindOf('eng-x'), 'workshop');
  assert.equal(buildingKindOf('reviewer'), 'guild');
  assert.equal(buildingKindOf('reviewer-1'), 'guild');
  assert.equal(buildingKindOf('designer'), 'guild');
  assert.equal(buildingKindOf('scratch'), 'house');
});

test('areas: court first, one district per project, messaged-only keeps the last seen project', () => {
  const tracker = createKingdomTracker();
  const sessions = [session('a', 'alpha'), session('lead', 'team-hq'), session('eng-x', 'alpha'), session('b', 'beta')];
  const first = tracker.update(input({ sessions }));
  assert.deepEqual(first.areas.map((area) => area.id), ['@court', 'alpha', 'beta']);
  assert.deepEqual(first.areas[0]?.buildings.map((building) => building.name), ['lead', 'eng-x']);
  const messages = [message('out', 'a', 'b', NOW - 1000)];
  const second = tracker.update(input({ sessions: [session('b', 'beta')], messages, nowMs: NOW + 1000 }));
  assert.equal(findBuilding(second, 'a')?.areaId, 'alpha');
  assert.equal(findBuilding(second, 'a')?.state, 'stopped');
  const unknown = createKingdomTracker().update(input({ sessions: [session('b', 'beta')], messages }));
  assert.equal(findBuilding(unknown, 'a')?.areaId, 'other');
  const named = createKingdomTracker().update(input({ sessions: [session('b', 'beta')], messages: [message('out', 'reviewer', 'b', NOW)] }));
  assert.equal(findBuilding(named, 'reviewer')?.areaId, '@court');
});

test('building states: active, idle with idle time, stopped, and absent after an hour', () => {
  const kingdom = createKingdomTracker().update(input({
    sessions: [session('a', 'p', NOW - 90_000), session('b', 'p', NOW - 90_000)],
    messages: [
      message('out', 'a', 'b', NOW - 10_000),
      message('out', 'c', 'a', NOW - 20 * 60_000),
      message('out', 'd', 'a', NOW - HOUR - 1000),
    ],
  }));
  assert.equal(findBuilding(kingdom, 'a')?.state, 'active');
  assert.equal(findBuilding(kingdom, 'b')?.state, 'active');
  assert.equal(findBuilding(kingdom, 'c')?.state, 'stopped');
  assert.equal(findBuilding(kingdom, 'd'), undefined);
  assert.equal(buildingsOf(kingdom).length, 3);
});

test('a running session without a recent message is idle with its idle time', () => {
  const kingdom = createKingdomTracker().update(input({ sessions: [session('a', 'p', NOW - 45_000)] }));
  assert.equal(findBuilding(kingdom, 'a')?.state, 'idle');
  assert.equal(findBuilding(kingdom, 'a')?.idleMs, 45_000);
});

test('buildings keep their slot, and districts their order, while others arrive and leave', () => {
  const tracker = createKingdomTracker();
  const update = (entries: [string, string][], nowMs: number) =>
    tracker.update(input({ sessions: entries.map(([name, project]) => session(name, project)), nowMs }));
  const slots = (kingdom: Kingdom) => new Map(buildingsOf(kingdom).map((building) => [building.name, building.slot]));
  const first = update([['a', 'x'], ['b', 'x'], ['c', 'x'], ['m', 'y']], NOW);
  const second = update([['a', 'x'], ['c', 'x'], ['d', 'x'], ['m', 'y'], ['n', 'z']], NOW + 1000);
  assert.equal(slots(second).get('a'), slots(first).get('a'));
  assert.equal(slots(second).get('c'), slots(first).get('c'));
  assert.equal(slots(second).get('d'), slots(first).get('b'));
  assert.equal(slots(second).get('m'), 0);
  assert.deepEqual(second.areas.map((area) => area.id), ['x', 'y', 'z']);
  const third = update([['m', 'y'], ['n', 'z'], ['q', 'w'], ['a', 'x']], NOW + 2000);
  assert.deepEqual(third.areas.map((area) => area.id), ['x', 'y', 'z', 'w']);
  assert.equal(slots(third).get('a'), slots(first).get('a'));
});

test('one mailman for the out and in record of a message, gone after 30 s, nothing cumulative', () => {
  const tracker = createKingdomTracker();
  const sessions = [session('a'), session('b')];
  const messages = [message('out', 'a', 'b', NOW - 1000), message('in', 'b', 'a', NOW - 900)];
  const first = tracker.update(input({ sessions, messages }));
  assert.equal(first.mailmen.length, 1);
  assert.equal(first.mailmen[0]?.from, 'a');
  assert.equal(first.mailmen[0]?.to, 'b');
  const later = tracker.update(input({ sessions, messages, nowMs: NOW + 2000 }));
  assert.equal(later.mailmen.length, 1);
  assert.ok((later.mailmen[0]?.progress ?? 0) > 0);
  const gone = tracker.update(input({ sessions, messages, nowMs: NOW + MAILMAN_LIFETIME_MS }));
  assert.equal(gone.mailmen.length, 0);
  const still = tracker.update(input({ sessions, messages, nowMs: NOW + MAILMAN_LIFETIME_MS + 2000 }));
  assert.equal(still.mailmen.length, 0);
});

test('an in record without its out still gets one mailman; old messages on opening get none', () => {
  const tracker = createKingdomTracker();
  const sessions = [session('a'), session('b')];
  const first = tracker.update(input({
    sessions,
    messages: [message('in', 'b', 'a', NOW - 5000), message('out', 'a', 'b', NOW - 20 * 60_000)],
  }));
  assert.equal(first.mailmen.length, 1);
  const next = tracker.update(input({
    sessions,
    messages: [message('out', 'b', 'a', NOW + 1000), message('in', 'b', 'a', NOW - 5000)],
    nowMs: NOW + 2000,
  }));
  assert.equal(next.mailmen.length, 2);
});

test('a subagent hand-back is a mailman inside the parent building, worker to boss', () => {
  const handBack: MessageInfo = {
    tsMs: NOW - 1000, kind: 'subagent', direction: 'in', sessionId: 'id-a', sessionName: 'a', peer: 'agent-1', snippet: '', agentId: 'agent-1',
  };
  const kingdom = createKingdomTracker().update(input({ sessions: [session('a')], messages: [handBack] }));
  assert.equal(kingdom.mailmen.length, 1);
  assert.equal(kingdom.mailmen[0]?.insideBuilding, 'a');
  assert.equal(kingdom.mailmen[0]?.from, 'agent-1');
  assert.equal(kingdom.mailmen[0]?.to, 'boss');
});

test('working subagents are workers, capped at six with a "+N more" count; done ones are not shown', () => {
  const agents = [...Array(8).keys()].map((index) => subagent(`w${index}`, 'id-a'));
  agents.push(subagent('finished', 'id-a', 'done'), subagent('other', 'id-b'));
  const kingdom = createKingdomTracker().update(input({ sessions: [session('a'), session('b')], subagents: agents }));
  assert.equal(findBuilding(kingdom, 'a')?.workers.length, WORKERS_SHOWN_MAX);
  assert.equal(findBuilding(kingdom, 'a')?.moreWorkers, 2);
  assert.equal(findBuilding(kingdom, 'b')?.workers.length, 1);
});

test('a new session alert or pending permission sends one mailman to the castle; items present at the start send none', () => {
  const tracker = createKingdomTracker();
  const sessions = [session('a'), session('b')];
  const first = tracker.update(input({ sessions, alerts: [alert('session:id-a')], permissions: [permission('p0', 'a')] }));
  assert.equal(first.mailmen.length, 0);
  const second = tracker.update(input({
    sessions,
    alerts: [alert('session:id-a'), alert('session:id-b'), alert('usage:5h')],
    permissions: [permission('p0', 'a'), permission('p1', 'a'), permission('p2', 'b', 'expired')],
    nowMs: NOW + 1000,
  }));
  const toCastle = second.mailmen.filter((mailman) => mailman.to === CASTLE_ID);
  assert.deepEqual(toCastle.map((mailman) => mailman.from).sort(), ['a', 'b']);
  const third = tracker.update(input({
    sessions,
    alerts: [alert('session:id-a'), alert('session:id-b')],
    permissions: [permission('p0', 'a'), permission('p1', 'a')],
    nowMs: NOW + 2000,
  }));
  assert.equal(third.mailmen.filter((mailman) => mailman.to === CASTLE_ID).length, 2);
  const gone = tracker.update(input({ sessions, nowMs: NOW + MAILMAN_LIFETIME_MS + 2000 }));
  assert.equal(gone.mailmen.length, 0);
});
