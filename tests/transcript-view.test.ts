import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeFixture } from './helpers.ts';
import { parseEntries, readTranscriptPage } from '../src/server/transcript-view.ts';

const fx = makeFixture();
const L = (o: object) => JSON.stringify(o);
const ts = '2026-10-01T10:00:00Z';

test('turns transcript lines into readable entries', () => {
  const entries = parseEntries([
    L({ type: 'user', uuid: 'u1', timestamp: ts, message: { content: 'please fix the bug' } }),
    L({
      type: 'assistant', uuid: 'a1', timestamp: ts,
      message: {
        content: [
          { type: 'thinking', thinking: 'secret thoughts' },
          { type: 'text', text: 'On it.' },
          { type: 'tool_use', name: 'Bash', input: { command: 'npm   test', description: 'run tests' } },
          { type: 'tool_use', name: 'Edit', input: { file_path: 'src/a.ts', old_string: 'x' } },
        ],
      },
    }),
    L({ type: 'user', uuid: 'r1', timestamp: ts, message: { content: [{ type: 'tool_result', content: 'boom', is_error: true }] } }),
    L({ type: 'user', uuid: 'r2', timestamp: ts, message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: 'ok' }] }] } }),
    L({ type: 'user', uuid: 'p1', timestamp: ts, origin: { kind: 'peer', from: 'shopapp-0c', body: 'hello there' } }),
    L({ type: 'user', uuid: 'm1', timestamp: ts, isMeta: true, message: { content: 'meta' } }),
    L({ type: 'user', uuid: 's1', timestamp: ts, message: { content: [{ type: 'text', text: '<system-reminder>x</system-reminder>' }] } }),
    L({ type: 'attachment', uuid: 'x1', timestamp: ts }),
    '{broken',
    '',
  ]);
  assert.deepEqual(
    entries.map((e) => [e.role, e.text]),
    [
      ['user', 'please fix the bug'],
      ['assistant', 'On it.'],
      ['tool', 'Bash: npm test'],
      ['tool', 'Edit: src/a.ts'],
      ['result', 'boom'],
      ['result', 'ok'],
      ['peer', 'hello there'],
    ],
  );
  assert.equal(entries[4].isError, true);
  assert.equal(entries[6].from, 'shopapp-0c');
  assert.ok(!JSON.stringify(entries).includes('secret thoughts'));
});

test('peer messages: queued_command attachment and user line, name else from, uds: pipe becomes unknown', () => {
  const pipe = String.raw`uds:\\.\pipe\LOCAL\cc-msg-0000000000000000000000000000000a`;
  const entries = parseEntries([
    L({
      type: 'attachment', uuid: 'at1', timestamp: ts,
      attachment: { type: 'queued_command', prompt: '<cross-session-message>x</cross-session-message>', origin: { kind: 'peer', from: pipe, name: 'probe-T-003', body: 'T-003 format probe from probe-T-003' }, isMeta: true },
    }),
    L({ type: 'user', uuid: 'up1', timestamp: ts, origin: { kind: 'peer', from: pipe, body: 'no name' } }),
    // A subagent hand-back attachment is left out: the Agent tool result already carries the report.
    L({
      type: 'attachment', uuid: 'at2', timestamp: ts,
      attachment: { type: 'queued_command', origin: { kind: 'peer', from: 'a1b2c3', senderTaskId: 'a1b2c3', name: 'Explore', body: '[Subagent hand-back] Done.', handback: true } },
    }),
  ]);
  assert.deepEqual(
    entries.map((e) => [e.role, e.from, e.text]),
    [['peer', 'probe-T-003', 'T-003 format probe from probe-T-003'], ['peer', 'unknown', 'no name']],
  );
});

test('truncates long tool results to 2 KB', () => {
  const [e] = parseEntries([L({ type: 'user', uuid: 'r', message: { content: [{ type: 'tool_result', content: 'x'.repeat(5000) }] } })]);
  assert.ok(e.text.startsWith('x'.repeat(2048)));
  assert.match(e.text, /2952 more characters/);
});

test('pages from the end and supports loading earlier entries', async () => {
  const file = join(fx.root, 't.jsonl');
  writeFileSync(file, Array.from({ length: 10 }, (_, i) => L({ type: 'user', uuid: `u${i}`, timestamp: ts, message: { content: `m${i}` } })).join('\n'));
  const last = await readTranscriptPage(file, 3);
  assert.deepEqual(last.entries.map((e) => e.text), ['m7', 'm8', 'm9']);
  assert.equal(last.hasMore, true);
  const earlier = await readTranscriptPage(file, 3, 'u7');
  assert.deepEqual(earlier.entries.map((e) => e.text), ['m4', 'm5', 'm6']);
  const first = await readTranscriptPage(file, 5, 'u2');
  assert.deepEqual(first.entries.map((e) => e.text), ['m0', 'm1']);
  assert.equal(first.hasMore, false);
});

test('reads only the tail of very large transcripts and says so', async () => {
  const file = join(fx.root, 'big.jsonl');
  writeFileSync(file, Array.from({ length: 200 }, (_, i) => L({ type: 'user', uuid: `b${i}`, timestamp: ts, message: { content: `line ${i}` } })).join('\n'));
  const page = await readTranscriptPage(file, 500, undefined, 1000);
  assert.equal(page.truncated, true);
  assert.equal(page.hasMore, false);
  assert.ok(page.entries.length > 0 && page.entries.length < 200);
  assert.equal(page.entries.at(-1)!.text, 'line 199');
  assert.ok(page.entries.every((e) => /^line \d+$/.test(e.text)), 'partial first line is dropped');
});
