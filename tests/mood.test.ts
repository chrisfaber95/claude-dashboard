import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionInfo, SubagentInfo } from '../src/shared/types.ts';
import { CORE_LABEL, coreHeadline, coreSummary, moodOf } from '../src/client/mood.ts';
import type { CoreSummary } from '../src/client/mood.ts';

const session = (status: string, name = 'S'): SessionInfo => ({ status, name }) as unknown as SessionInfo;
const sub = (state: 'working' | 'done'): SubagentInfo => ({ state }) as unknown as SubagentInfo;
const summary = (p: Partial<CoreSummary>): CoreSummary => ({
  mood: 'standby',
  busy: 0,
  waiting: 0,
  subagentsWorking: 0,
  waitingName: null,
  ...p,
});

test('moodOf maps busy, waiting and everything else to idle', () => {
  assert.equal(moodOf({ status: 'busy' }), 'busy');
  assert.equal(moodOf({ status: 'waiting' }), 'waiting');
  assert.equal(moodOf({ status: 'idle' }), 'idle');
  assert.equal(moodOf({ status: 'whatever' as SessionInfo['status'] }), 'idle');
});

test('coreSummary is standby with nothing running', () => {
  assert.deepEqual(coreSummary({ sessions: [], subagents: [] }), summary({}));
});

test('coreSummary tolerates missing subagents', () => {
  const c = coreSummary({ sessions: [session('busy')], subagents: undefined as unknown as SubagentInfo[] });
  assert.equal(c.mood, 'working');
  assert.equal(c.subagentsWorking, 0);
});

test('coreSummary is working for a busy session', () => {
  const c = coreSummary({ sessions: [session('busy'), session('idle')], subagents: [] });
  assert.deepEqual(c, summary({ mood: 'working', busy: 1 }));
});

test('coreSummary is working for a working subagent only; done alone stays standby', () => {
  assert.deepEqual(coreSummary({ sessions: [], subagents: [sub('working'), sub('done')] }), summary({ mood: 'working', subagentsWorking: 1 }));
  assert.equal(coreSummary({ sessions: [], subagents: [sub('done')] }).mood, 'standby');
});

test('coreSummary: waiting beats busy and names the first waiting session', () => {
  const c = coreSummary({
    sessions: [session('busy', 'A'), session('waiting', 'B'), session('waiting', 'C'), session('busy', 'D')],
    subagents: [sub('working')],
  });
  assert.deepEqual(c, { mood: 'waiting', busy: 2, waiting: 2, subagentsWorking: 1, waitingName: 'B' });
});

test('CORE_LABEL values', () => {
  assert.deepEqual(CORE_LABEL, { standby: 'Standby', working: 'Working', waiting: 'Needs you' });
});

test('coreHeadline for standby', () => {
  assert.equal(coreHeadline(summary({})), 'All quiet. Nothing running.');
});

test('coreHeadline for working', () => {
  assert.equal(coreHeadline(summary({ mood: 'working', busy: 1 })), '1 session working');
  assert.equal(coreHeadline(summary({ mood: 'working', busy: 3, subagentsWorking: 2 })), '3 sessions working · 2 subagents');
  assert.equal(coreHeadline(summary({ mood: 'working', busy: 1, subagentsWorking: 1 })), '1 session working · 1 subagent');
  assert.equal(coreHeadline(summary({ mood: 'working', subagentsWorking: 2 })), '2 subagents working');
  assert.equal(coreHeadline(summary({ mood: 'working', subagentsWorking: 1 })), '1 subagent working');
});

test('coreHeadline for waiting', () => {
  assert.equal(coreHeadline(summary({ mood: 'waiting', waiting: 1, waitingName: 'Alpha' })), 'Alpha is waiting for you');
  assert.equal(coreHeadline(summary({ mood: 'waiting', waiting: 1, busy: 2, waitingName: 'Alpha' })), 'Alpha is waiting for you · 2 more working');
  assert.equal(coreHeadline(summary({ mood: 'waiting', waiting: 1 })), 'A session is waiting for you');
});
