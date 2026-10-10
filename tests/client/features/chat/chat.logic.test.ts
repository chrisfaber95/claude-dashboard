import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Alert, DashboardState, SessionInfo } from '../../../../src/shared/types/index.ts';
import { answer, fmtTokens, HELP_TEXT, parseIntent } from '../../../../src/client/features/chat/chat.logic.ts';

const NOW = new Date(2026, 9, 9, 12, 0, 0).getTime();
const tok = (n: number) => ({ input: n, output: 0, cacheRead: 0, cacheWrite: 0 });
const session = (sessionId: string, name: string, project: string, status = 'busy'): SessionInfo =>
  ({ sessionId, name, project, status }) as unknown as SessionInfo;
const alert = (id: string, title: string, detail = 'Waiting for you'): Alert =>
  ({ id, kind: 'session', title, detail, sinceMs: 0, resetsAtMs: null }) as Alert;

function makeState(p: Partial<DashboardState> = {}): DashboardState {
  return {
    generatedAtMs: NOW,
    projects: [],
    sessions: [session('aaaa1111-0', 'Builder', 'alpha', 'busy'), session('bbbb2222-0', 'Tester', 'beta', 'waiting')],
    subagents: [],
    messages: [],
    usage: { days: [{ day: '2026-10-09', byProject: {}, byModel: {}, tokens: tok(1500) }], totals: tok(2_500_000), byModel: {} },
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
    ...p,
  } as DashboardState;
}

const kind = (t: string, s = makeState()) => parseIntent(t, s).kind;

test('status phrasings, case-insensitive', () => {
  for (const t of ["what's running?", "WHAT'S RUNNING", 'status', 'what is going on', 'show me the sessions']) {
    assert.equal(kind(t), 'status', t);
  }
});

test('attention phrasings', () => {
  for (const t of ['what needs me?', 'WHAT NEEDS ME', 'anything waiting for me?', 'any alerts', 'attention']) {
    assert.equal(kind(t), 'attention', t);
  }
});

test('usage phrasings', () => {
  for (const t of ['usage', 'how many tokens did I use', 'what are my limits?', 'when do the limits reset', 'Quota']) {
    assert.equal(kind(t), 'usage', t);
  }
});

test('unknown input falls back to help', () => {
  for (const t of ['', 'hello', 'tell builder', 'open']) assert.equal(kind(t), 'help', t);
  assert.equal(answer(parseIntent('???', makeState()), makeState()), HELP_TEXT);
});

test('help lists every capability', () => {
  for (const w of ['running', 'needs me', 'usage', 'tell', 'dismiss', 'open', 'summarize']) assert.match(HELP_TEXT, new RegExp(w));
});

test('message carries the resolved session, the exact text and needs confirm', () => {
  for (const t of ['send builder: run the tests', 'Tell Builder: run the tests', 'message to builder:  run the tests ']) {
    const i = parseIntent(t, makeState());
    assert.equal(i.kind, 'message', t);
    if (i.kind !== 'message') return;
    assert.equal(i.text, 'run the tests');
    assert.equal(i.needsConfirm, true);
    assert.equal(i.match.kind, 'one');
    if (i.match.kind === 'one') assert.equal(i.match.item.sessionId, 'aaaa1111-0');
  }
});

test('message keeps colons, case and newlines in the text', () => {
  const i = parseIntent('tell tester: Fix A: now\nThen B', makeState());
  assert.ok(i.kind === 'message' && i.text === 'Fix A: now\nThen B');
});

test('message to an unknown session gives no match and a reply', () => {
  const s = makeState();
  const i = parseIntent('tell nobody: hi', s);
  assert.ok(i.kind === 'message' && i.match.kind === 'none');
  assert.match(answer(i, s), /No session matches "nobody"/);
});

test('message confirmation reply shows session and exact text', () => {
  const s = makeState();
  assert.match(answer(parseIntent('tell tester: Go ahead', s), s), /Send to Tester: "Go ahead"/);
});

test('sessions match by name, project and id prefix', () => {
  const s = makeState();
  for (const q of ['builder', 'BUILD', 'alpha', 'aaaa', 'aaaa1111-0']) {
    const i = parseIntent(`open ${q}`, s);
    assert.ok(i.kind === 'open' && i.match.kind === 'one' && i.match.item.name === 'Builder', q);
  }
});

test('ambiguous session lists the candidates instead of guessing', () => {
  const s = makeState({ sessions: [session('aaaa1', 'Builder', 'alpha'), session('aaaa2', 'Builder-2', 'alpha')] });
  const i = parseIntent('open alpha', s);
  assert.ok(i.kind === 'open' && i.match.kind === 'many' && i.match.items.length === 2);
  const reply = answer(i, s);
  assert.match(reply, /matches 2 sessions/);
  assert.match(reply, /Builder \(alpha, aaaa1\)/);
  assert.match(reply, /Builder-2/);
  const m = parseIntent('tell aaaa: hi', s);
  assert.ok(m.kind === 'message' && m.match.kind === 'many');
});

test('an exact name wins over a longer name that contains it', () => {
  const s = makeState({ sessions: [session('x1', 'build', 'p'), session('x2', 'build-more', 'p')] });
  const i = parseIntent('open build', s);
  assert.ok(i.kind === 'open' && i.match.kind === 'one' && i.match.item.sessionId === 'x1');
});

test('open and summary resolve sessions; unknown names reply with no match', () => {
  const s = makeState();
  for (const t of ['summarize tester', 'summarise tester', 'summary of tester', 'recap tester']) {
    const i = parseIntent(t, s);
    assert.ok(i.kind === 'summary' && i.match.kind === 'one', t);
  }
  assert.match(answer(parseIntent('open ghost', s), s), /No session matches "ghost"/);
  assert.match(answer(parseIntent('summarize ghost', s), s), /No session matches "ghost"/);
  assert.match(answer(parseIntent('open tester', s), s), /Opening Tester/);
});

test('ack resolves an alert by title, session project or id prefix', () => {
  const s = makeState();
  for (const q of ['tester', 'beta', 'session:bbbb', 'bbbb', '5-hour', 'usage:five']) {
    const i = parseIntent(`dismiss ${q}`, s);
    assert.equal(i.kind, 'ack', q);
    assert.equal(i.kind === 'ack' && i.match.kind, 'one', q);
  }
  for (const t of ['acknowledge tester', 'ack tester', 'Dismiss Tester.']) assert.equal(kind(t, s), 'ack', t);
  assert.match(answer(parseIntent('dismiss tester', s), s), /Dismissing alert "Tester"/);
});

test('ack with several or no matches lists or says so', () => {
  const s = makeState({ alerts: { items: [alert('session:s1', 'Ops'), alert('session:s2', 'Ops')], threshold: 80 } });
  const many = answer(parseIntent('dismiss ops', s), s);
  assert.match(many, /matches 2 alerts/);
  assert.match(many, /session:s1/);
  assert.match(answer(parseIntent('dismiss nothing', s), s), /No open alert matches "nothing"/);
});

test('status reply lists sessions with their mood and subagents', () => {
  const s = makeState({ subagents: [{ state: 'working' }, { state: 'done' }] as DashboardState['subagents'] });
  const r = answer(parseIntent("what's running?", s), s);
  assert.match(r, /2 live sessions/);
  assert.match(r, /Builder \(alpha\): working/);
  assert.match(r, /Tester \(beta\): waiting for you/);
  assert.match(r, /1 subagent working/);
});

test('status reply when nothing runs', () => {
  const s = makeState({ sessions: [] });
  assert.equal(answer({ kind: 'status' }, s), 'Nothing is running.');
});

test('attention reply lists alerts and team items, or says all is quiet', () => {
  const s = makeState({ team: { counts: {}, active: {}, needsYou: ['T-9 needs approval'] } as unknown as DashboardState['team'] });
  const r = answer({ kind: 'attention' }, s);
  assert.match(r, /3 things need you/);
  assert.match(r, /Tester: Waiting for you/);
  assert.match(r, /T-9 needs approval/);
  assert.equal(answer({ kind: 'attention' }, makeState({ alerts: { items: [], threshold: 80 } })), 'Nothing needs you right now.');
});

test('usage reply shows tokens and limit windows with percentage and reset, never cost', () => {
  const r = answer({ kind: 'usage' }, makeState());
  assert.match(r, /Tokens in total: 2\.5M/);
  assert.match(r, /Tokens today: 1\.5k/);
  assert.match(r, /5-hour: 42% used, resets in 2h 10m/);
  assert.doesNotMatch(r, /\$|cost|USD/i);
  assert.match(answer({ kind: 'usage' }, makeState({ limits: { source: 'none', fetchedAtMs: null, error: null, windows: [], hits: [] } })), /No limit data/);
});

test('fmtTokens scales', () => {
  assert.deepEqual([fmtTokens(999), fmtTokens(1500), fmtTokens(2_500_000), fmtTokens(3e9)], ['999', '1.5k', '2.5M', '3.0B']);
});

test('verbs that precede a keyword question fall through to that intent', () => {
  const s = makeState();
  const cases: Array<[string, string]> = [
    ['view usage', 'usage'],
    ['view sessions', 'status'],
    ['go to alerts', 'attention'],
    ['clear alerts', 'attention'],
    ['summary of my usage', 'usage'],
    ['open the limits', 'usage'],
  ];
  for (const [t, k] of cases) assert.equal(kind(t, s), k, t);
});

test('a verb with a real match still wins over the keyword intents', () => {
  const s = makeState({ sessions: [session('s1', 'usage-bot', 'p')] });
  assert.equal(kind('open usage-bot', s), 'open');
  assert.equal(kind('summarize usage-bot', s), 'summary');
});

test('a verb with no match and no keyword still replies with no match', () => {
  assert.equal(kind('open ghost'), 'open');
  assert.equal(kind('dismiss nothing'), 'ack');
});

test('usage reply tolerates missing usage data', () => {
  const s = makeState({ usage: undefined as unknown as DashboardState['usage'] });
  const r = answer({ kind: 'usage' }, s);
  assert.match(r, /5-hour: 42% used/);
  assert.doesNotMatch(r, /Tokens in total/);
});
