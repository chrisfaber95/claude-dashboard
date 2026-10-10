// Transcript scanning: project mapping, token aggregates, dedupe and incremental reads.
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assistantLine, jsonl, makeFixture, transcriptDir } from '../../helpers.ts';

const fx = makeFixture();
const transcriptsModule = await import('../../../src/server/transcripts/transcripts.ts');
const { localDay } = await import('../../../src/server/config.ts');

const cwdA = join(fx.projectsRoot, 'Alpha');
const cwdB = join(fx.projectsRoot, 'Beta', 'sub', 'dir');
let count = 0;
const freshDir = (cwd: string) => {
  // Each test gets its own transcript folder so earlier files don't leak in.
  const directory = join(transcriptDir(fx, cwd), `t${++count}`);
  mkdirSync(directory, { recursive: true });
  return directory;
};

beforeEach(() => transcriptsModule.resetTranscripts());

test('projectOf maps cwds under the projects root to the top-level folder', () => {
  assert.equal(transcriptsModule.projectOf(cwdA), 'Alpha');
  assert.equal(transcriptsModule.projectOf(cwdB), 'Beta');
  assert.equal(transcriptsModule.projectOf(cwdB.replace(/\\/g, '/')), 'Beta');
  assert.equal(transcriptsModule.projectOf('C:\\elsewhere\\Gamma'), 'Gamma');
});

test('aggregates token usage per session, day, project and model', () => {
  const directory = freshDir(cwdA);
  writeFileSync(
    join(directory, 's1.jsonl'),
    jsonl([
      { type: 'user', sessionId: 's1', cwd: cwdA, timestamp: '2026-10-01T10:00:00Z', message: { role: 'user', content: 'hi' } },
      assistantLine({ sessionId: 's1', cwd: cwdA, ts: '2026-10-01T10:00:01Z', id: 'm1', gitBranch: 'main' }),
      assistantLine({ sessionId: 's1', cwd: cwdA, ts: '2026-10-01T10:00:02Z', id: 'm2', model: 'claude-opus-5-5', usage: { output_tokens: 100 } }),
    ]),
  );
  transcriptsModule.scanTranscripts();

  const session = transcriptsModule.sessionAgg.get('s1')!;
  assert.deepEqual(session.tokens, { input: 10, output: 120, cacheRead: 30, cacheWrite: 40 });
  assert.equal(session.branch, 'main');
  assert.equal(session.project, 'Alpha');

  const day = transcriptsModule.dayAgg.get(localDay(Date.parse('2026-10-01T10:00:01Z')))!;
  assert.equal(day.byProject.Alpha, 200);
  assert.equal(day.byModel['claude-sonnet-5-5'], 100);
  assert.equal(day.byModel['claude-opus-5-5'], 100);
  assert.equal(transcriptsModule.modelTotals['claude-opus-5-5'], 100);
  assert.equal(transcriptsModule.projectLastActive.get('Alpha'), Date.parse('2026-10-01T10:00:02Z'));
});

test('dedupes streamed duplicates and skips synthetic messages', () => {
  const directory = freshDir(cwdA);
  const line = assistantLine({ sessionId: 's2', cwd: cwdA, ts: '2026-10-01T10:00:01Z', id: 'dup', requestId: 'r1' });
  writeFileSync(
    join(directory, 's2.jsonl'),
    jsonl([line, line, assistantLine({ sessionId: 's2', cwd: cwdA, ts: '2026-10-01T10:00:02Z', id: 'syn', model: '<synthetic>' })]),
  );
  transcriptsModule.scanTranscripts();
  assert.equal(transcriptsModule.sessionAgg.get('s2')!.tokens.output, 20);
  assert.equal(transcriptsModule.modelTotals['<synthetic>'], undefined);
});

test('reads incrementally, carrying partial lines and split multibyte chars across scans', () => {
  const directory = freshDir(cwdA);
  const file = join(directory, 's3.jsonl');
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
  transcriptsModule.scanTranscripts();
  assert.equal(transcriptsModule.sessionAgg.get('s3')!.tokens.output, 20);
  assert.equal(transcriptsModule.messages.length, 0, 'partial line must not be parsed yet');

  appendFileSync(file, bytes.subarray(cut));
  appendFileSync(file, jsonl([assistantLine({ sessionId: 's3', cwd: cwdA, ts: '2026-10-01T11:00:01Z', id: 'b' })]));
  transcriptsModule.scanTranscripts();
  assert.equal(transcriptsModule.sessionAgg.get('s3')!.tokens.output, 40, 'first line counted once, new line added');
  assert.equal(transcriptsModule.messages.length, 1);
  assert.equal(transcriptsModule.messages[0].snippet, 'héllo — wörld ✓');
});

test('restarts from zero when a transcript is truncated', () => {
  const directory = freshDir(cwdA);
  const file = join(directory, 's4.jsonl');
  writeFileSync(
    file,
    jsonl([
      assistantLine({ sessionId: 's4', cwd: cwdA, ts: '2026-10-01T10:00:00Z', id: 't1' }),
      assistantLine({ sessionId: 's4', cwd: cwdA, ts: '2026-10-01T10:00:01Z', id: 't2' }),
    ]),
  );
  transcriptsModule.scanTranscripts();
  writeFileSync(file, jsonl([assistantLine({ sessionId: 's4', cwd: cwdA, ts: '2026-10-01T10:00:02Z', id: 't3' })]));
  transcriptsModule.scanTranscripts();
  assert.equal(transcriptsModule.sessionAgg.get('s4')!.tokens.output, 60);
});

test('attributes subagent usage to the parent session without emitting messages', () => {
  const directory = freshDir(cwdB);
  const subDir = join(directory, 'parent-1', 'subagents');
  mkdirSync(subDir, { recursive: true });
  writeFileSync(
    join(subDir, 'agent-x.jsonl'),
    jsonl([
      assistantLine({ sessionId: 'parent-1', cwd: cwdB, ts: '2026-10-01T10:00:00Z', id: 'sub1', usage: { output_tokens: 7 } }),
      { type: 'user', sessionId: 'parent-1', cwd: cwdB, timestamp: '2026-10-01T10:00:01Z', origin: { kind: 'peer', from: 'x', body: 'y' } },
    ]),
  );
  transcriptsModule.scanTranscripts();
  assert.equal(transcriptsModule.sessionAgg.get('parent-1')!.tokens.output, 7);
  assert.equal(transcriptsModule.messages.filter((message) => message.sessionId === 'parent-1').length, 0);
});

test('classifies peer messages and outgoing SendMessage calls', () => {
  const directory = freshDir(cwdA);
  writeFileSync(
    join(directory, 's5.jsonl'),
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
  transcriptsModule.scanTranscripts();
  const mine = transcriptsModule.messages.filter((message) => message.sessionId === 's5');
  assert.equal(mine.length, 3);
  const [sub, inc, out] = mine;
  assert.equal(sub.kind, 'subagent');
  assert.equal(sub.snippet, 'Done.');
  assert.deepEqual([inc.kind, inc.direction, inc.peer, inc.snippet], ['session', 'in', 'shopapp-0c', 'can you rebase?']);
  assert.deepEqual([out.kind, out.direction, out.peer, out.snippet], ['session', 'out', 'webshop-1a', 'ping']);
});

const PIPE = String.raw`\\.\pipe\LOCAL\cc-msg-0000000000000000000000000000000a`;
const peerAttachment = (currentSessionId: string, ts: string, origin: object) => ({
  parentUuid: '00000000-0000-4000-8000-000000000001', isSidechain: false, type: 'attachment', sessionId: currentSessionId, cwd: cwdA, timestamp: ts,
  attachment: { type: 'queued_command', commandMode: 'prompt', origin, timestamp: ts, isMeta: true },
});

test('real Claude Code 2.1.295 cross-session lines: queued_command attachment in, SendMessage out, queue-operation ignored', () => {
  const directory = freshDir(cwdA);
  const body = 'T-003 format probe from probe-T-003';
  writeFileSync(
    join(directory, 'x1.jsonl'),
    jsonl([
      { type: 'queue-operation', operation: 'enqueue', timestamp: '2026-10-08T20:57:05.600Z', sessionId: 'x1', content: `<cross-session-message from="uds:${PIPE}" from-name="probe-T-003">\n${body}\n</cross-session-message>` },
      peerAttachment('x1', '2026-10-08T20:57:05.614Z', { kind: 'peer', from: `uds:${PIPE}`, msg_id: '00000000-0000-4000-8000-000000000004', name: 'probe-T-003', fromMode: 'prompting', body }),
      assistantLine({
        sessionId: 'x1', cwd: cwdA, ts: '2026-10-08T20:57:05.592Z', id: 'out1',
        content: [{ type: 'tool_use', id: 'toolu_fixture', name: 'SendMessage', input: { to: 'baseline-T-003', message: body, summary: 's', type: 'message', recipient: 'baseline-T-003', recipient_kind: 'name', content: body }, caller: { type: 'direct' } }],
      }),
    ]),
  );
  transcriptsModule.scanTranscripts();
  const mine = transcriptsModule.messages.filter((message) => message.sessionId === 'x1');
  assert.equal(mine.length, 2);
  const inc = mine.find((message) => message.direction === 'in')!;
  const out = mine.find((message) => message.direction === 'out')!;
  assert.deepEqual([inc.kind, inc.peer], ['session', 'probe-T-003']);
  assert.ok(inc.snippet.includes(body));
  assert.deepEqual([out.kind, out.peer], ['session', 'baseline-T-003']);
});

test('an unnamed peer on a local pipe address shows as unknown, an unnamed plain from is kept', () => {
  const directory = freshDir(cwdA);
  writeFileSync(
    join(directory, 'x2.jsonl'),
    jsonl([
      peerAttachment('x2', '2026-10-08T21:00:00Z', { kind: 'peer', from: `uds:${PIPE}`, body: 'via pipe' }),
      peerAttachment('x2', '2026-10-08T21:00:01Z', { kind: 'peer', from: 'shopapp-0c', body: 'plain' }),
    ]),
  );
  transcriptsModule.scanTranscripts();
  const peers = transcriptsModule.messages.filter((message) => message.sessionId === 'x2').map((message) => message.peer);
  assert.deepEqual(peers, ['unknown', 'shopapp-0c']);
});

test('strips the ListAgents ref suffix from an outgoing recipient', () => {
  const directory = freshDir(cwdA);
  const content = [{ type: 'tool_use', name: 'SendMessage', input: { to: 'worker [3fa9c1]', message: 'hi' } }];
  writeFileSync(join(directory, 'x3.jsonl'), jsonl([assistantLine({ sessionId: 'x3', cwd: cwdA, ts: '2026-10-08T21:10:00Z', id: 'o1', content })]));
  transcriptsModule.scanTranscripts();
  assert.deepEqual(transcriptsModule.messages.filter((message) => message.sessionId === 'x3').map((message) => message.peer), ['worker']);
});

test('records rate-limit rejections', () => {
  const directory = freshDir(cwdA);
  writeFileSync(
    join(directory, 's6.jsonl'),
    jsonl([
      {
        type: 'assistant', sessionId: 's6', cwd: cwdA, timestamp: '2026-10-01T13:00:00Z', isApiErrorMessage: true,
        quotaLimits: { status: 'rejected', resetsAt: 1790804400, rateLimitType: 'five_hour' },
      },
      { type: 'assistant', sessionId: 's6', cwd: cwdA, timestamp: '2026-10-01T13:00:01Z', quotaLimits: { status: 'allowed' } },
    ]),
  );
  transcriptsModule.scanTranscripts();
  assert.deepEqual(transcriptsModule.limitHits, [
    { tsMs: Date.parse('2026-10-01T13:00:00Z'), type: 'five_hour', resetsAtMs: 1790804400000, project: 'Alpha' },
  ]);
});

test('ignores malformed lines', () => {
  const directory = freshDir(cwdA);
  writeFileSync(join(directory, 's7.jsonl'), '{not json\n' + jsonl([assistantLine({ sessionId: 's7', cwd: cwdA, ts: '2026-10-01T10:00:00Z', id: 'ok' })]));
  transcriptsModule.scanTranscripts();
  assert.equal(transcriptsModule.sessionAgg.get('s7')!.tokens.output, 20);
});
