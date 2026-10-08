import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assistantLine, jsonl, makeFixture, transcriptDir } from './helpers.ts';

const fx = makeFixture();
const T = await import('../src/server/transcripts.ts');
const { localDay } = await import('../src/server/config.ts');

const cwdA = join(fx.projectsRoot, 'Alpha');
const cwdB = join(fx.projectsRoot, 'Beta', 'sub', 'dir');
let n = 0;
const freshDir = (cwd: string) => {
  // Each test gets its own transcript folder so earlier files don't leak in.
  const d = join(transcriptDir(fx, cwd), `t${++n}`);
  mkdirSync(d, { recursive: true });
  return d;
};

beforeEach(() => T.resetTranscripts());

test('projectOf maps cwds under the projects root to the top-level folder', () => {
  assert.equal(T.projectOf(cwdA), 'Alpha');
  assert.equal(T.projectOf(cwdB), 'Beta');
  assert.equal(T.projectOf(cwdB.replace(/\\/g, '/')), 'Beta');
  assert.equal(T.projectOf('C:\\elsewhere\\Gamma'), 'Gamma');
});

test('aggregates token usage per session, day, project and model', () => {
  const d = freshDir(cwdA);
  writeFileSync(
    join(d, 's1.jsonl'),
    jsonl([
      { type: 'user', sessionId: 's1', cwd: cwdA, timestamp: '2026-10-01T10:00:00Z', message: { role: 'user', content: 'hi' } },
      assistantLine({ sessionId: 's1', cwd: cwdA, ts: '2026-10-01T10:00:01Z', id: 'm1', gitBranch: 'main' }),
      assistantLine({ sessionId: 's1', cwd: cwdA, ts: '2026-10-01T10:00:02Z', id: 'm2', model: 'claude-opus-5-5', usage: { output_tokens: 100 } }),
    ]),
  );
  T.scanTranscripts();

  const s = T.sessionAgg.get('s1')!;
  assert.deepEqual(s.tokens, { input: 10, output: 120, cacheRead: 30, cacheWrite: 40 });
  assert.equal(s.branch, 'main');
  assert.equal(s.project, 'Alpha');

  const day = T.dayAgg.get(localDay(Date.parse('2026-10-01T10:00:01Z')))!;
  assert.equal(day.byProject.Alpha, 200);
  assert.equal(day.byModel['claude-sonnet-5-5'], 100);
  assert.equal(day.byModel['claude-opus-5-5'], 100);
  assert.equal(T.modelTotals['claude-opus-5-5'], 100);
  assert.equal(T.projectLastActive.get('Alpha'), Date.parse('2026-10-01T10:00:02Z'));
});

test('dedupes streamed duplicates and skips synthetic messages', () => {
  const d = freshDir(cwdA);
  const line = assistantLine({ sessionId: 's2', cwd: cwdA, ts: '2026-10-01T10:00:01Z', id: 'dup', requestId: 'r1' });
  writeFileSync(
    join(d, 's2.jsonl'),
    jsonl([line, line, assistantLine({ sessionId: 's2', cwd: cwdA, ts: '2026-10-01T10:00:02Z', id: 'syn', model: '<synthetic>' })]),
  );
  T.scanTranscripts();
  assert.equal(T.sessionAgg.get('s2')!.tokens.output, 20);
  assert.equal(T.modelTotals['<synthetic>'], undefined);
});

test('reads incrementally, carrying partial lines and split multibyte chars across scans', () => {
  const d = freshDir(cwdA);
  const file = join(d, 's3.jsonl');
  const peer = {
    type: 'user',
    sessionId: 's3',
    cwd: cwdA,
    timestamp: '2026-10-01T11:00:00Z',
    origin: { kind: 'peer', from: 'other-session', body: 'héllo — wörld ✓' },
    message: { role: 'user', content: 'x' },
  };
  const bytes = Buffer.from(JSON.stringify(peer) + '\n', 'utf8');
  const cut = bytes.indexOf(Buffer.from('—', 'utf8')) + 1; // split inside the 3-byte em dash

  writeFileSync(file, jsonl([assistantLine({ sessionId: 's3', cwd: cwdA, ts: '2026-10-01T10:59:00Z', id: 'a' })]));
  appendFileSync(file, bytes.subarray(0, cut));
  T.scanTranscripts();
  assert.equal(T.sessionAgg.get('s3')!.tokens.output, 20);
  assert.equal(T.messages.length, 0, 'partial line must not be parsed yet');

  appendFileSync(file, bytes.subarray(cut));
  appendFileSync(file, jsonl([assistantLine({ sessionId: 's3', cwd: cwdA, ts: '2026-10-01T11:00:01Z', id: 'b' })]));
  T.scanTranscripts();
  assert.equal(T.sessionAgg.get('s3')!.tokens.output, 40, 'first line counted once, new line added');
  assert.equal(T.messages.length, 1);
  assert.equal(T.messages[0].snippet, 'héllo — wörld ✓');
});

test('restarts from zero when a transcript is truncated', () => {
  const d = freshDir(cwdA);
  const file = join(d, 's4.jsonl');
  writeFileSync(
    file,
    jsonl([
      assistantLine({ sessionId: 's4', cwd: cwdA, ts: '2026-10-01T10:00:00Z', id: 't1' }),
      assistantLine({ sessionId: 's4', cwd: cwdA, ts: '2026-10-01T10:00:01Z', id: 't2' }),
    ]),
  );
  T.scanTranscripts();
  writeFileSync(file, jsonl([assistantLine({ sessionId: 's4', cwd: cwdA, ts: '2026-10-01T10:00:02Z', id: 't3' })]));
  T.scanTranscripts();
  assert.equal(T.sessionAgg.get('s4')!.tokens.output, 60);
});

test('attributes subagent usage to the parent session without emitting messages', () => {
  const d = freshDir(cwdB);
  const subDir = join(d, 'parent-1', 'subagents');
  mkdirSync(subDir, { recursive: true });
  writeFileSync(
    join(subDir, 'agent-x.jsonl'),
    jsonl([
      assistantLine({ sessionId: 'parent-1', cwd: cwdB, ts: '2026-10-01T10:00:00Z', id: 'sub1', usage: { output_tokens: 7 } }),
      { type: 'user', sessionId: 'parent-1', cwd: cwdB, timestamp: '2026-10-01T10:00:01Z', origin: { kind: 'peer', from: 'x', body: 'y' } },
    ]),
  );
  T.scanTranscripts();
  assert.equal(T.sessionAgg.get('parent-1')!.tokens.output, 7);
  assert.equal(T.messages.filter((m) => m.sessionId === 'parent-1').length, 0);
});

test('classifies peer messages and outgoing SendMessage calls', () => {
  const d = freshDir(cwdA);
  writeFileSync(
    join(d, 's5.jsonl'),
    jsonl([
      {
        type: 'user', sessionId: 's5', cwd: cwdA, timestamp: '2026-10-01T12:00:00Z',
        origin: { kind: 'peer', from: 'a1b2c3', senderTaskId: 'a1b2c3', body: '[Subagent hand-back] The report follows:\n  Done.' },
      },
      { type: 'user', sessionId: 's5', cwd: cwdA, timestamp: '2026-10-01T12:00:01Z', origin: { kind: 'peer', from: 'shopapp-0c', body: 'can you rebase?' } },
      { type: 'user', sessionId: 's5', cwd: cwdA, timestamp: '2026-10-01T12:00:02Z', origin: { kind: 'human' }, message: { content: 'not a peer' } },
      assistantLine({
        sessionId: 's5', cwd: cwdA, ts: '2026-10-01T12:00:03Z', id: 'send',
        content: [{ type: 'tool_use', name: 'SendMessage', input: { to: 'webshop-1a', message: 'ping' } }],
      }),
    ]),
  );
  T.scanTranscripts();
  const mine = T.messages.filter((m) => m.sessionId === 's5');
  assert.equal(mine.length, 3);
  const [sub, inc, out] = mine;
  assert.equal(sub.kind, 'subagent');
  assert.equal(sub.snippet, 'Done.');
  assert.deepEqual([inc.kind, inc.direction, inc.peer, inc.snippet], ['session', 'in', 'shopapp-0c', 'can you rebase?']);
  assert.deepEqual([out.kind, out.direction, out.peer, out.snippet], ['session', 'out', 'webshop-1a', 'ping']);
});

const PIPE = String.raw`\\.\pipe\LOCAL\cc-msg-0000000000000000000000000000000a`;
const peerAttachment = (sid: string, ts: string, origin: object) => ({
  parentUuid: '00000000-0000-4000-8000-000000000001', isSidechain: false, type: 'attachment', sessionId: sid, cwd: cwdA, timestamp: ts,
  attachment: { type: 'queued_command', commandMode: 'prompt', origin, timestamp: ts, isMeta: true },
});

test('real Claude Code 2.1.295 cross-session lines: queued_command attachment in, SendMessage out, queue-operation ignored', () => {
  const d = freshDir(cwdA);
  const body = 'T-003 format probe from probe-T-003';
  writeFileSync(
    join(d, 'x1.jsonl'),
    jsonl([
      { type: 'queue-operation', operation: 'enqueue', timestamp: '2026-10-08T20:57:05.600Z', sessionId: 'x1', content: `<cross-session-message from="uds:${PIPE}" from-name="probe-T-003">\n${body}\n</cross-session-message>` },
      peerAttachment('x1', '2026-10-08T20:57:05.614Z', { kind: 'peer', from: `uds:${PIPE}`, msg_id: '00000000-0000-4000-8000-000000000004', name: 'probe-T-003', fromMode: 'prompting', body }),
      assistantLine({
        sessionId: 'x1', cwd: cwdA, ts: '2026-10-08T20:57:05.592Z', id: 'out1',
        content: [{ type: 'tool_use', id: 'toolu_fixture', name: 'SendMessage', input: { to: 'baseline-T-003', message: body, summary: 's', type: 'message', recipient: 'baseline-T-003', recipient_kind: 'name', content: body }, caller: { type: 'direct' } }],
      }),
    ]),
  );
  T.scanTranscripts();
  const mine = T.messages.filter((m) => m.sessionId === 'x1');
  assert.equal(mine.length, 2);
  const inc = mine.find((m) => m.direction === 'in')!;
  const out = mine.find((m) => m.direction === 'out')!;
  assert.deepEqual([inc.kind, inc.peer], ['session', 'probe-T-003']);
  assert.ok(inc.snippet.includes(body));
  assert.deepEqual([out.kind, out.peer], ['session', 'baseline-T-003']);
});

test('an unnamed peer on a local pipe address shows as unknown, an unnamed plain from is kept', () => {
  const d = freshDir(cwdA);
  writeFileSync(
    join(d, 'x2.jsonl'),
    jsonl([
      peerAttachment('x2', '2026-10-08T21:00:00Z', { kind: 'peer', from: `uds:${PIPE}`, body: 'via pipe' }),
      peerAttachment('x2', '2026-10-08T21:00:01Z', { kind: 'peer', from: 'shopapp-0c', body: 'plain' }),
    ]),
  );
  T.scanTranscripts();
  const peers = T.messages.filter((m) => m.sessionId === 'x2').map((m) => m.peer);
  assert.deepEqual(peers, ['unknown', 'shopapp-0c']);
});

test('strips the ListAgents ref suffix from an outgoing recipient', () => {
  const d = freshDir(cwdA);
  const content = [{ type: 'tool_use', name: 'SendMessage', input: { to: 'worker [3fa9c1]', message: 'hi' } }];
  writeFileSync(join(d, 'x3.jsonl'), jsonl([assistantLine({ sessionId: 'x3', cwd: cwdA, ts: '2026-10-08T21:10:00Z', id: 'o1', content })]));
  T.scanTranscripts();
  assert.deepEqual(T.messages.filter((m) => m.sessionId === 'x3').map((m) => m.peer), ['worker']);
});

test('records rate-limit rejections', () => {
  const d = freshDir(cwdA);
  writeFileSync(
    join(d, 's6.jsonl'),
    jsonl([
      {
        type: 'assistant', sessionId: 's6', cwd: cwdA, timestamp: '2026-10-01T13:00:00Z', isApiErrorMessage: true,
        quotaLimits: { status: 'rejected', resetsAt: 1790804400, rateLimitType: 'five_hour' },
      },
      { type: 'assistant', sessionId: 's6', cwd: cwdA, timestamp: '2026-10-01T13:00:01Z', quotaLimits: { status: 'allowed' } },
    ]),
  );
  T.scanTranscripts();
  assert.deepEqual(T.limitHits, [
    { tsMs: Date.parse('2026-10-01T13:00:00Z'), type: 'five_hour', resetsAtMs: 1790804400000, project: 'Alpha' },
  ]);
});

test('ignores malformed lines', () => {
  const d = freshDir(cwdA);
  writeFileSync(join(d, 's7.jsonl'), '{not json\n' + jsonl([assistantLine({ sessionId: 's7', cwd: cwdA, ts: '2026-10-01T10:00:00Z', id: 'ok' })]));
  T.scanTranscripts();
  assert.equal(T.sessionAgg.get('s7')!.tokens.output, 20);
});
