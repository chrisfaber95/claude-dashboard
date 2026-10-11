// Core mood and headline text derived from live sessions and subagents.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionInfo, SubagentInfo } from '../../../../src/shared/types/index.ts';
import { CORE_LABEL, coreHeadline, coreSummary, moodOf, coreHeadlineParts } from '../../../../src/client/features/core/mood.logic.ts';
import type { CoreSummary } from '../../../../src/client/features/core/mood.logic.ts';

const session = (status: string, name = 'S'): SessionInfo => ({
  sessionId: 'session',
  pid: 1,
  name,
  project: 'project',
  cwd: '',
  status,
  entrypoint: 'cli',
  kind: 'interactive',
  startedAtMs: 0,
  updatedAtMs: 0,
  branch: null,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
});
const sub = (state: SubagentInfo['state']): SubagentInfo => ({
  agentId: 'agent',
  sessionId: 'session',
  project: 'project',
  agentType: 'general-purpose',
  description: '',
  prompt: '',
  background: false,
  parentAgentId: null,
  startedAtMs: 0,
  lastTsMs: 0,
  state,
  handedBack: false,
  activity: '',
  result: '',
  tokens: 0,
});
/** A copy that went through JSON, typed loosely: for inputs an older server could send with fields missing. */
const looseCopy = (value: unknown) => JSON.parse(JSON.stringify(value));
const summary = (overrides: Partial<CoreSummary>): CoreSummary => ({
  mood: 'standby',
  busy: 0,
  waiting: 0,
  subagentsWorking: 0,
  waitingName: null,
  ...overrides,
});

test('moodOf maps busy, waiting and everything else to idle', () => {
  assert.equal(moodOf({ status: 'busy' }), 'busy');
  assert.equal(moodOf({ status: 'waiting' }), 'waiting');
  assert.equal(moodOf({ status: 'idle' }), 'idle');
  assert.equal(moodOf({ status: 'whatever' }), 'idle');
});

test('coreSummary is standby with nothing running', () => {
  assert.deepEqual(coreSummary({ sessions: [], subagents: [] }), summary({}));
});

test('coreSummary tolerates missing subagents', () => {
  const core = coreSummary(looseCopy({ sessions: [session('busy')] }));
  assert.equal(core.mood, 'working');
  assert.equal(core.subagentsWorking, 0);
});

test('coreSummary is working for a busy session', () => {
  const core = coreSummary({ sessions: [session('busy'), session('idle')], subagents: [] });
  assert.deepEqual(core, summary({ mood: 'working', busy: 1 }));
});

test('coreSummary is working for a working subagent only; done alone stays standby', () => {
  assert.deepEqual(coreSummary({ sessions: [], subagents: [sub('working'), sub('done')] }), summary({ mood: 'working', subagentsWorking: 1 }));
  assert.equal(coreSummary({ sessions: [], subagents: [sub('done')] }).mood, 'standby');
});

test('coreSummary: waiting beats busy and names the first waiting session', () => {
  const core = coreSummary({
    sessions: [session('busy', 'A'), session('waiting', 'B'), session('waiting', 'C'), session('busy', 'D')],
    subagents: [sub('working')],
  });
  assert.deepEqual(core, { mood: 'waiting', busy: 2, waiting: 2, subagentsWorking: 1, waitingName: 'B' });
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

const CASES: Array<[string, CoreSummary, string, string]> = [
  ['standby', summary({}), 'All quiet. ', 'Nothing running.'],
  ['sessions and subagents', summary({ mood: 'working', busy: 3, subagentsWorking: 2 }), '3 sessions working · ', '2 subagents'],
  ['one of each', summary({ mood: 'working', busy: 1, subagentsWorking: 1 }), '1 session working · ', '1 subagent'],
  ['single session', summary({ mood: 'working', busy: 1 }), '1 session working', ''],
  ['subagents only', summary({ mood: 'working', subagentsWorking: 2 }), '2 subagents working', ''],
  ['waiting', summary({ mood: 'waiting', waiting: 1, waitingName: 'Alpha' }), 'Alpha is waiting for you', ''],
  ['waiting with busy', summary({ mood: 'waiting', waiting: 1, busy: 2, waitingName: 'Alpha' }), 'Alpha is waiting for you · ', '2 more working'],
  ['waiting without a name', summary({ mood: 'waiting', waiting: 1 }), 'A session is waiting for you', ''],
  ['waiting without a name, with busy', summary({ mood: 'waiting', waiting: 1, busy: 1 }), 'A session is waiting for you · ', '1 more working'],
];

for (const [label, coreSummaryCase, lead, accent] of CASES) {
  test(`coreHeadlineParts: ${label}`, () => {
    assert.deepEqual(coreHeadlineParts(coreSummaryCase), { lead, accent });
    assert.equal(coreHeadline(coreSummaryCase), lead + accent);
  });
}

test('coreHeadlineParts: a waiting session name with ". " or " · " stays whole in lead', () => {
  for (const name of ['Fix v1. Release', 'a · b', 'x. y · z']) {
    for (const busy of [0, 2]) {
      const waitingSummary = summary({ mood: 'waiting', waiting: 1, busy, waitingName: name });
      const parts = coreHeadlineParts(waitingSummary);
      assert.ok(parts.lead.startsWith(`${name} is waiting for you`), `${name}: lead ${JSON.stringify(parts.lead)}`);
      assert.equal(parts.accent, busy ? '2 more working' : '');
      assert.ok(!parts.accent.includes(name) && !name.split(/ · |\. /).some((part) => part.length > 2 && parts.accent.includes(part)));
      assert.equal(coreHeadline(waitingSummary), parts.lead + parts.accent);
    }
  }
});
