import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { SessionSummary } from '../../../src/shared/types/index.ts';
import { assistantLine, jsonl, makeFixture, raw, transcriptDir } from '../../helpers.ts';

const fx = makeFixture();
process.env.TEAM_HQ_DIR = join(fx.root, 'no-team-hq');
const publicDir = join(fx.root, 'public');
mkdirSync(publicDir);
writeFileSync(join(publicDir, 'index.html'), '<!doctype html><title>t</title>');

const { createDashboardServer } = await import('../../../src/server/server.ts');
const { recapSession } = await import('../../../src/server/claude/session-summary.ts');
const server = createDashboardServer({ publicDir });
let port = 0;

const ID = '11111111-2222-3333-4444-555555555555';
const cwd = join(fx.projectsRoot, 'demo');
const SECRET = 'FAKE-SECRET-FOR-TEST';
const longReply = 'x'.repeat(500);
const tool = (n: number, name: string, input: object) =>
  assistantLine({ sessionId: ID, cwd, ts: `2026-10-01T10:0${n}:00Z`, id: `m${n}`, usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 }, content: [{ type: 'tool_use', name, input }] });
const path = join(transcriptDir(fx, cwd), `${ID}.jsonl`);

before(async () => {
  mkdirSync(cwd, { recursive: true });
  writeFileSync(
    path,
    jsonl([
      { type: 'user', sessionId: ID, cwd, timestamp: '2026-10-01T10:00:00Z', uuid: 'u1', message: { content: 'go' } },
      tool(1, 'Read', { file_path: 'src/old.ts' }),
      tool(2, 'Edit', { file_path: 'src/server/auth.ts', old_string: SECRET }),
      tool(3, 'Bash', { command: `npm test -- --grep ${'z'.repeat(100)}` }),
      tool(4, 'Grep', { pattern: 'foo' }),
      tool(5, 'Write', { file_path: 'src/new.ts', content: SECRET }),
      tool(6, 'TodoWrite', { todos: [SECRET] }),
      assistantLine({ sessionId: ID, cwd, ts: '2026-10-01T10:07:00Z', id: 'm7', content: [{ type: 'text', text: longReply }] }),
    ]),
  );
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
after(() => {
  server.closeAllConnections();
  server.close();
});

test('the recap has times, status, token totals, the last 5 actions and a cut reply', async () => {
  const r = await recapSession(path, { status: 'idle', startedAtMs: Date.parse('2026-10-01T09:59:00Z') });
  assert.equal(r.mode, 'recap');
  assert.match(r.text, /Started: 2026-10-01 09:59 UTC/);
  assert.match(r.text, /Last activity: 2026-10-01 10:07 UTC/);
  assert.match(r.text, /Status: idle/);
  // 6 tool turns of 1/2/3/4 plus the reply turn of 10/20/30/40.
  assert.match(r.text, /Tokens: 160 \(in 16, out 32, cache read 48, cache write 64\)/);
  const actions = r.text.split('Last actions:\n')[1].split('\nLast reply')[0].split('\n');
  assert.equal(actions.length, 5);
  assert.equal(actions[0], '- Edit src/server/auth.ts');
  assert.ok(actions[1].startsWith('- Bash: npm test'));
  assert.ok(actions[1].length <= '- Bash: '.length + 60);
  assert.deepEqual(actions.slice(2), ['- Grep foo', '- Write src/new.ts', '- TodoWrite']);
  assert.match(r.text, /Last reply: x{299}…$/);
  assert.ok(!/cost|\$/i.test(r.text));
});

test('a recap without a live session says it is not running and takes times from the transcript', async () => {
  const r = await recapSession(path);
  assert.match(r.text, /Status: not running/);
  assert.match(r.text, /Started: 2026-10-01 10:00 UTC/);
});

test('tool inputs other than the target never reach the recap', async () => {
  const r = await recapSession(path);
  assert.ok(!r.text.includes(SECRET));
  assert.ok(!r.text.includes('old_string'));
  assert.ok(!r.text.includes('todos'));
});

test('only the tail of a big transcript is read', async () => {
  const r = await recapSession(path, undefined, 1200);
  assert.match(r.text, /Last reply: x{299}…$/);
  assert.ok(!r.text.includes('src/old.ts'));
});

test('GET /api/sessions/:id/summary returns the recap; bad or unknown ids fail with fixed strings', async () => {
  const get = (p: string) => raw(port, { path: p, headers: { Host: `127.0.0.1:${port}` } });
  const ok = await get(`/api/sessions/${ID}/summary`);
  assert.equal(ok.status, 200);
  const body = JSON.parse(ok.body) as SessionSummary;
  assert.equal(body.mode, 'recap');
  assert.match(body.text, /Last reply:/);
  const unknown = await get('/api/sessions/99999999-2222-3333-4444-555555555555/summary');
  assert.equal(unknown.status, 404);
  assert.deepEqual(JSON.parse(unknown.body), { error: 'unknown session' });
  const bad = await get('/api/sessions/not-an-id/summary');
  assert.equal(bad.status, 400);
  assert.deepEqual(JSON.parse(bad.body), { error: 'invalid session id' });
});

test('secrets in a command or URL are masked before the target is cut', async () => {
  const p = join(transcriptDir(fx, cwd), 'redact.jsonl');
  writeFileSync(
    p,
    jsonl([
      tool(1, 'Bash', { command: 'curl -H "Authorization: Bearer sk-FAKE123" https://u:pw@h.test/a?token=FAKE456' }),
      tool(2, 'Bash', { command: 'export API_TOKEN=FAKE789 && npm test' }),
    ]),
  );
  const r = await recapSession(p);
  assert.doesNotMatch(r.text, /FAKE\d|pw@/);
  assert.match(r.text, /npm test/);
});
