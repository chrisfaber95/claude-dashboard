// Chat intents: what a typed phrase means and how the chat answers it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Alert, DashboardState, SessionInfo } from '../../../../src/shared/types/index.ts';
import { answer, fmtTokens, HELP_TEXT, parseIntent } from '../../../../src/client/features/chat/chat.logic.ts';

const NOW = new Date(2026, 9, 9, 12, 0, 0).getTime();
const tokenCounts = (count: number) => ({ input: count, output: 0, cacheRead: 0, cacheWrite: 0 });
const session = (sessionId: string, name: string, project: string, status = 'busy'): SessionInfo =>
  ({ sessionId, name, project, status }) as unknown as SessionInfo;
const alert = (id: string, title: string, detail = 'Waiting for you'): Alert =>
  ({ id, kind: 'session', title, detail, sinceMs: 0, resetsAtMs: null }) as Alert;

function makeState(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    generatedAtMs: NOW,
    projects: [],
    sessions: [session('aaaa1111-0', 'Builder', 'alpha', 'busy'), session('bbbb2222-0', 'Tester', 'beta', 'waiting')],
    subagents: [],
    messages: [],
    usage: { days: [{ day: '2026-10-09', byProject: {}, byModel: {}, tokens: tokenCounts(1500) }], totals: tokenCounts(2_500_000), byModel: {} },
    limits: {
      source: 'live',
      fetchedAtMs: NOW,
      error: null,
      windows: [{ key: 'five_hour', label: '5-hour', utilization: 42.4, resetsAtMs: NOW + 130 * 60000 }],
      hits: [],
    },
    recentSessions: [],
    alerts: { items: [alert('session:bbbb2222-0', 'Tester'), alert('usage:five_hour', '5-hour', '87% used')], threshold: 80 },
    team: null,
    ...overrides,
  } as DashboardState;
}

const kind = (text: string, state = makeState()) => parseIntent(text, state).kind;

test('status phrasings, case-insensitive', () => {
  for (const phrase of ["what's running?", "WHAT'S RUNNING", 'status', 'what is going on', 'show me the sessions']) {
    assert.equal(kind(phrase), 'status', phrase);
  }
});

test('attention phrasings', () => {
  for (const phrase of ['what needs me?', 'WHAT NEEDS ME', 'anything waiting for me?', 'any alerts', 'attention']) {
    assert.equal(kind(phrase), 'attention', phrase);
  }
});

test('usage phrasings', () => {
  for (const phrase of ['usage', 'how many tokens did I use', 'what are my limits?', 'when do the limits reset', 'Quota']) {
    assert.equal(kind(phrase), 'usage', phrase);
  }
});

test('unknown input falls back to help', () => {
  for (const phrase of ['', 'hello', 'tell builder', 'open']) assert.equal(kind(phrase), 'help', phrase);
  assert.equal(answer(parseIntent('???', makeState()), makeState()), HELP_TEXT);
});

test('help lists every capability', () => {
  for (const word of ['running', 'needs me', 'usage', 'tell', 'dismiss', 'open', 'summarize']) assert.match(HELP_TEXT, new RegExp(word));
});

test('message carries the resolved session, the exact text and needs confirm', () => {
  for (const phrase of ['send builder: run the tests', 'Tell Builder: run the tests', 'message to builder:  run the tests ']) {
    const intent = parseIntent(phrase, makeState());
    assert.equal(intent.kind, 'message', phrase);
    if (intent.kind !== 'message') return;
    assert.equal(intent.text, 'run the tests');
    assert.equal(intent.needsConfirm, true);
    assert.equal(intent.match.kind, 'one');
    if (intent.match.kind === 'one') assert.equal(intent.match.item.sessionId, 'aaaa1111-0');
  }
});

test('message keeps colons, case and newlines in the text', () => {
  const intent = parseIntent('tell tester: Fix A: now\nThen B', makeState());
  assert.ok(intent.kind === 'message' && intent.text === 'Fix A: now\nThen B');
});

test('message to an unknown session gives no match and a reply', () => {
  const state = makeState();
  const intent = parseIntent('tell nobody: hi', state);
  assert.ok(intent.kind === 'message' && intent.match.kind === 'none');
  assert.match(answer(intent, state), /No session matches "nobody"/);
});

test('message confirmation reply shows session and exact text', () => {
  const state = makeState();
  assert.match(answer(parseIntent('tell tester: Go ahead', state), state), /Send to Tester: "Go ahead"/);
});

test('sessions match by name, project and id prefix', () => {
  const state = makeState();
  for (const query of ['builder', 'BUILD', 'alpha', 'aaaa', 'aaaa1111-0']) {
    const intent = parseIntent(`open ${query}`, state);
    assert.ok(intent.kind === 'open' && intent.match.kind === 'one' && intent.match.item.name === 'Builder', query);
  }
});

test('ambiguous session lists the candidates instead of guessing', () => {
  const state = makeState({ sessions: [session('aaaa1', 'Builder', 'alpha'), session('aaaa2', 'Builder-2', 'alpha')] });
  const intent = parseIntent('open alpha', state);
  assert.ok(intent.kind === 'open' && intent.match.kind === 'many' && intent.match.items.length === 2);
  const reply = answer(intent, state);
  assert.match(reply, /matches 2 sessions/);
  assert.match(reply, /Builder \(alpha, aaaa1\)/);
  assert.match(reply, /Builder-2/);
  const messageIntent = parseIntent('tell aaaa: hi', state);
  assert.ok(messageIntent.kind === 'message' && messageIntent.match.kind === 'many');
});

test('an exact name wins over a longer name that contains it', () => {
  const state = makeState({ sessions: [session('x1', 'build', 'p'), session('x2', 'build-more', 'p')] });
  const intent = parseIntent('open build', state);
  assert.ok(intent.kind === 'open' && intent.match.kind === 'one' && intent.match.item.sessionId === 'x1');
});

test('open and summary resolve sessions; unknown names reply with no match', () => {
  const state = makeState();
  for (const phrase of ['summarize tester', 'summarise tester', 'summary of tester', 'recap tester']) {
    const intent = parseIntent(phrase, state);
    assert.ok(intent.kind === 'summary' && intent.match.kind === 'one', phrase);
  }
  assert.match(answer(parseIntent('open ghost', state), state), /No session matches "ghost"/);
  assert.match(answer(parseIntent('summarize ghost', state), state), /No session matches "ghost"/);
  assert.match(answer(parseIntent('open tester', state), state), /Opening Tester/);
});

test('ack resolves an alert by title, session project or id prefix', () => {
  const state = makeState();
  for (const query of ['tester', 'beta', 'session:bbbb', 'bbbb', '5-hour', 'usage:five']) {
    const intent = parseIntent(`dismiss ${query}`, state);
    assert.equal(intent.kind, 'ack', query);
    assert.equal(intent.kind === 'ack' && intent.match.kind, 'one', query);
  }
  for (const phrase of ['acknowledge tester', 'ack tester', 'Dismiss Tester.']) assert.equal(kind(phrase, state), 'ack', phrase);
  assert.match(answer(parseIntent('dismiss tester', state), state), /Dismissing alert "Tester"/);
});

test('ack with several or no matches lists or says so', () => {
  const state = makeState({ alerts: { items: [alert('session:s1', 'Ops'), alert('session:s2', 'Ops')], threshold: 80 } });
  const many = answer(parseIntent('dismiss ops', state), state);
  assert.match(many, /matches 2 alerts/);
  assert.match(many, /session:s1/);
  assert.match(answer(parseIntent('dismiss nothing', state), state), /No open alert matches "nothing"/);
});

test('status reply lists sessions with their mood and subagents', () => {
  const state = makeState({ subagents: [{ state: 'working' }, { state: 'done' }] as DashboardState['subagents'] });
  const reply = answer(parseIntent("what's running?", state), state);
  assert.match(reply, /2 live sessions/);
  assert.match(reply, /Builder \(alpha\): working/);
  assert.match(reply, /Tester \(beta\): waiting for you/);
  assert.match(reply, /1 subagent working/);
});

test('status reply when nothing runs', () => {
  const state = makeState({ sessions: [] });
  assert.equal(answer({ kind: 'status' }, state), 'Nothing is running.');
});

test('attention reply lists alerts and team items, or says all is quiet', () => {
  const state = makeState({ team: { counts: {}, active: {}, needsYou: ['T-9 needs approval'] } as unknown as DashboardState['team'] });
  const reply = answer({ kind: 'attention' }, state);
  assert.match(reply, /3 things need you/);
  assert.match(reply, /Tester: Waiting for you/);
  assert.match(reply, /T-9 needs approval/);
  assert.equal(answer({ kind: 'attention' }, makeState({ alerts: { items: [], threshold: 80 } })), 'Nothing needs you right now.');
});

test('usage reply shows tokens and limit windows with percentage and reset, never cost', () => {
  const reply = answer({ kind: 'usage' }, makeState());
  assert.match(reply, /Tokens in total: 2\.5M/);
  assert.match(reply, /Tokens today: 1\.5k/);
  assert.match(reply, /5-hour: 42% used, resets in 2h 10m/);
  assert.doesNotMatch(reply, /\$|cost|USD/i);
  assert.match(answer({ kind: 'usage' }, makeState({ limits: { source: 'none', fetchedAtMs: null, error: null, windows: [], hits: [] } })), /No limit data/);
});

test('fmtTokens scales', () => {
  assert.deepEqual([fmtTokens(999), fmtTokens(1500), fmtTokens(2_500_000), fmtTokens(3e9)], ['999', '1.5k', '2.5M', '3.0B']);
});

test('verbs that precede a keyword question fall through to that intent', () => {
  const state = makeState();
  const cases: Array<[string, string]> = [
    ['view usage', 'usage'],
    ['view sessions', 'status'],
    ['go to alerts', 'attention'],
    ['clear alerts', 'attention'],
    ['summary of my usage', 'usage'],
    ['open the limits', 'usage'],
  ];
  for (const [phrase, expectedKind] of cases) assert.equal(kind(phrase, state), expectedKind, phrase);
});

test('a verb with a real match still wins over the keyword intents', () => {
  const state = makeState({ sessions: [session('s1', 'usage-bot', 'p')] });
  assert.equal(kind('open usage-bot', state), 'open');
  assert.equal(kind('summarize usage-bot', state), 'summary');
});

test('a verb with no match and no keyword still replies with no match', () => {
  assert.equal(kind('open ghost'), 'open');
  assert.equal(kind('dismiss nothing'), 'ack');
});

test('usage reply tolerates missing usage data', () => {
  const state = makeState({ usage: undefined as unknown as DashboardState['usage'] });
  const reply = answer({ kind: 'usage' }, state);
  assert.match(reply, /5-hour: 42% used/);
  assert.doesNotMatch(reply, /Tokens in total/);
});
