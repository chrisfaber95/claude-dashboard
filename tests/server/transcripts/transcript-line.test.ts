// Typed transcript lines: unreadable or wrongly typed fields are skipped, never a crash.
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assistantLine, jsonl, makeFixture, transcriptDir } from '../../helpers.ts';
import { parseEntries } from '../../../src/server/transcripts/transcript-view.ts';
import { parseTranscriptLine } from '../../../src/server/transcripts/transcript-line.ts';

const fx = makeFixture();
const transcriptsModule = await import('../../../src/server/transcripts/transcripts.ts');

const cwd = join(fx.projectsRoot, 'Typed');

beforeEach(() => transcriptsModule.resetTranscripts());

test('parseTranscriptLine returns undefined for unreadable and non-object lines', () => {
  assert.equal(parseTranscriptLine('{"type":"user"'), undefined);
  assert.equal(parseTranscriptLine('null'), undefined);
  assert.equal(parseTranscriptLine('42'), undefined);
  assert.equal(parseTranscriptLine('"text"'), undefined);
  assert.equal(parseTranscriptLine('[{"type":"user"}]'), undefined);
});

test('parseTranscriptLine drops fields of the wrong type and keeps the rest', () => {
  const line = parseTranscriptLine(
    JSON.stringify({
      type: 'assistant',
      uuid: 7,
      timestamp: '2026-10-01T10:00:00Z',
      isSidechain: 'yes',
      message: {
        id: 'm1',
        content: [{ type: 'text', text: 5 }, { type: 'tool_use', name: 'Bash', input: 'ls' }, 'junk', { text: 'no type' }],
        usage: { input_tokens: 'many', output_tokens: 3 },
      },
      quotaLimits: { status: 'rejected', resetsAt: { soon: true } },
    }),
  );
  assert.ok(line);
  assert.equal(line.type, 'assistant');
  assert.equal(line.uuid, undefined);
  assert.equal(line.isSidechain, false);
  assert.deepEqual(line.message?.usage, { input: 0, output: 3, cacheRead: 0, cacheWrite: 0 });
  assert.equal(line.quotaLimits?.resetsAtSeconds, undefined);
  const content = line.message?.content;
  assert.ok(Array.isArray(content));
  assert.equal(content.length, 2);
  assert.equal(content[0].text, undefined);
  assert.equal(content[1].input, undefined);
});

test('parseEntries skips malformed lines and blocks without throwing', () => {
  const entries = parseEntries([
    'null',
    '[1]',
    JSON.stringify({ type: 'user', uuid: 'u1', message: 7 }),
    JSON.stringify({ type: 'user', uuid: 'u2', message: { content: [null, 4, { type: 'tool_result', content: { not: 'text' } }] } }),
    JSON.stringify({ type: 'assistant', uuid: 'a1', message: { content: [{ type: 'text', text: 9 }, { type: 'tool_use' }] } }),
    JSON.stringify({ type: 'user', uuid: 'u3', message: { content: 'still here' } }),
  ]);
  assert.deepEqual(
    entries.map((entry) => [entry.uuid, entry.role, entry.text]),
    [
      ['u2', 'result', ''],
      ['u3', 'user', 'still here'],
    ],
  );
});

test('the scanner skips wrongly typed lines and still counts the valid ones', () => {
  const directory = join(transcriptDir(fx, cwd), 't1');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, 'typed.jsonl'),
    [
      'null',
      '"just a string"',
      JSON.stringify({ type: 'assistant', sessionId: 'typed', cwd, timestamp: 12, message: { usage: 'lots', id: 4 } }),
      JSON.stringify({ type: 'assistant', sessionId: 'typed', cwd, timestamp: '2026-10-01T10:00:00Z', message: 'oops' }),
      JSON.stringify({ type: 'user', sessionId: 'typed', cwd, timestamp: '2026-10-01T10:00:01Z', origin: 'peer', message: { content: [3] } }),
      jsonl([assistantLine({ sessionId: 'typed', cwd, ts: '2026-10-01T10:00:02Z', id: 'ok1' })]).trim(),
      '',
    ].join('\n'),
  );
  transcriptsModule.scanTranscripts();

  const session = transcriptsModule.sessionAgg.get('typed');
  assert.ok(session);
  assert.deepEqual(session.tokens, { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 });
  assert.equal(transcriptsModule.messages.filter((message) => message.sessionId === 'typed').length, 0);
});
