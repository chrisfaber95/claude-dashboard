import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { assistantLine, jsonl, makeFixture, raw, transcriptDir } from './helpers.ts';

const fx = makeFixture();
const T = await import('../src/server/transcripts.ts');
const { parseEntries } = await import('../src/server/transcript-view.ts');
const { createDashboardServer } = await import('../src/server/server.ts');

const cwd = join(fx.projectsRoot, 'Alpha');
const MIN = 60_000;
const T0 = Date.parse('2026-10-01T10:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
let n = 0;

/** A fresh session folder so tests stay independent; returns ids and writers. */
function session() {
  const sid = `sess-${++n}`;
  const dir = transcriptDir(fx, cwd);
  const subDir = join(dir, sid, 'subagents');
  mkdirSync(subDir, { recursive: true });
  const main = join(dir, `${sid}.jsonl`);
  const agentFile = (id: string) => join(subDir, `agent-${id}.jsonl`);
  const meta = (id: string, m: object) => writeFileSync(join(subDir, `agent-${id}.meta.json`), JSON.stringify(m));
  return { sid, main, agentFile, meta };
}

const agentToolUse = (sid: string, ts: number, toolUseId: string, input: object) =>
  assistantLine({
    sessionId: sid, cwd, ts: iso(ts), id: `m-${toolUseId}`,
    content: [{ type: 'tool_use', id: toolUseId, name: 'Agent', input }],
  });

const subLine = (sid: string, agentId: string, ts: number, over: object = {}) => ({
  type: 'user', isSidechain: true, agentId, sessionId: sid, cwd, timestamp: iso(ts), uuid: `u-${agentId}-${ts}`,
  message: { role: 'user', content: 'the brief' },
  ...over,
});
const subAssistant = (sid: string, agentId: string, ts: number, id: string, content: unknown[], usage?: object) => ({
  ...assistantLine({ sessionId: sid, cwd, ts: iso(ts), id, content, usage }),
  isSidechain: true, agentId, uuid: `a-${id}`,
});

const fgResult = (sid: string, ts: number, toolUseId: string, agentId: string, text: string) => ({
  type: 'user', sessionId: sid, cwd, timestamp: iso(ts),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: text }] },
  toolUseResult: { status: 'completed', agentId, agentType: 'Explore', content: [{ type: 'text', text }], totalTokens: 5 },
});
const bgLaunch = (sid: string, ts: number, toolUseId: string, agentId: string) => ({
  type: 'user', sessionId: sid, cwd, timestamp: iso(ts),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'launched' }] },
  toolUseResult: { status: 'async_launched', agentId, isAsync: true },
});
const PREAMBLE = '[Subagent hand-back] This is an automatic message from a background agent. The report follows:\n  ';
const handbackAttachment = (sid: string, ts: number, agentId: string, report: string, name = 'Explore') => ({
  type: 'attachment', sessionId: sid, cwd, timestamp: iso(ts),
  attachment: { type: 'queued_command', origin: { kind: 'peer', from: agentId, senderTaskId: agentId, name, body: PREAMBLE + report, handback: true } },
});
const noticeAttachment = (sid: string, ts: number, agentId: string) => ({
  type: 'attachment', sessionId: sid, cwd, timestamp: iso(ts),
  attachment: { type: 'queued_command', prompt: `<task-notification>\n<task-id>${agentId}</task-id>\n<status>completed</status>\n</task-notification>` },
});

const live = (...ids: string[]) => new Set(ids);
const mine = (sid: string, now: number) => T.buildSubagents(live(sid), now).filter((s) => s.sessionId === sid);

beforeEach(() => T.resetTranscripts());

test('a subagent with recent activity and no hand-back is working, with its latest tool call', () => {
  const s = session();
  s.meta('aaaa11', { agentType: 'Explore', description: 'look around', toolUseId: 'tu1', spawnDepth: 1, requestShape: 'foreground' });
  writeFileSync(s.main, jsonl([agentToolUse(s.sid, T0, 'tu1', { description: 'look around', subagent_type: 'Explore', prompt: 'find things', run_in_background: false })]));
  writeFileSync(
    s.agentFile('aaaa11'),
    jsonl([
      subLine(s.sid, 'aaaa11', T0 + 1000),
      subAssistant(s.sid, 'aaaa11', T0 + 2000, 'x1', [{ type: 'tool_use', id: 't', name: 'Read', input: { file_path: 'src/a.ts' } }]),
    ]),
  );
  T.scanTranscripts();
  const [a] = mine(s.sid, T0 + MIN);
  assert.equal(a.state, 'working');
  assert.equal(a.agentType, 'Explore');
  assert.equal(a.description, 'look around');
  assert.equal(a.prompt, 'find things');
  assert.equal(a.background, false);
  assert.equal(a.parentAgentId, null);
  assert.equal(a.activity, 'Read: src/a.ts');
  assert.equal(a.result, '');
  assert.equal(a.project, 'Alpha');
  assert.equal(a.startedAtMs, T0);
});

test('a subagent quiet for over 5 minutes without a hand-back is done with an empty result, and dropped after 15 minutes', () => {
  const s = session();
  s.meta('bbbb22', { agentType: 'Explore', description: 'd', toolUseId: 'tu2', requestShape: 'foreground' });
  writeFileSync(s.main, jsonl([agentToolUse(s.sid, T0, 'tu2', { description: 'd', subagent_type: 'Explore', prompt: 'p' })]));
  writeFileSync(s.agentFile('bbbb22'), jsonl([subLine(s.sid, 'bbbb22', T0)]));
  T.scanTranscripts();

  assert.equal(mine(s.sid, T0 + 5 * MIN - 1)[0].state, 'working');
  const stale = mine(s.sid, T0 + 5 * MIN + 1)[0];
  assert.equal(stale.state, 'done');
  assert.equal(stale.result, '');
  assert.equal(stale.activity, '');
  assert.equal(mine(s.sid, T0 + 15 * MIN - 1).length, 1);
  assert.equal(mine(s.sid, T0 + 15 * MIN + 1).length, 0);
});

test('subagents of sessions that are not live are excluded', () => {
  const s = session();
  writeFileSync(s.agentFile('cccc33'), jsonl([subLine(s.sid, 'cccc33', T0)]));
  T.scanTranscripts();
  assert.equal(T.buildSubagents(live('some-other-session'), T0 + 1000).filter((x) => x.sessionId === s.sid).length, 0);
  assert.equal(T.buildSubagents(live(s.sid), T0 + 1000).filter((x) => x.sessionId === s.sid).length, 1);
});

test('foreground completion marks the subagent done and clips the result to 300 chars', () => {
  const s = session();
  s.meta('dddd44', { agentType: 'Explore', description: 'd', toolUseId: 'tu4', requestShape: 'foreground' });
  const long = 'word '.repeat(200);
  writeFileSync(
    s.main,
    jsonl([agentToolUse(s.sid, T0, 'tu4', { description: 'd', subagent_type: 'Explore', prompt: 'p' }), fgResult(s.sid, T0 + 10_000, 'tu4', 'dddd44', long)]),
  );
  writeFileSync(s.agentFile('dddd44'), jsonl([subLine(s.sid, 'dddd44', T0 + 1000)]));
  T.scanTranscripts();
  const [a] = mine(s.sid, T0 + 20_000);
  assert.equal(a.state, 'done');
  assert.ok(a.result.length <= 300, `length ${a.result.length}`);
  assert.ok(a.result.length > 250);
  assert.ok(a.result.endsWith('…'));
  assert.equal(a.activity, '');
});

test('a done subagent is dropped 15 minutes after its hand-back, not after its last line', () => {
  const s = session();
  s.meta('eeee55', { agentType: 'Explore', description: 'd', toolUseId: 'tu5', requestShape: 'foreground' });
  writeFileSync(
    s.main,
    jsonl([agentToolUse(s.sid, T0, 'tu5', { description: 'd', subagent_type: 'Explore', prompt: 'p' }), fgResult(s.sid, T0 + 20 * MIN, 'tu5', 'eeee55', 'ok')]),
  );
  writeFileSync(s.agentFile('eeee55'), jsonl([subLine(s.sid, 'eeee55', T0)]));
  T.scanTranscripts();
  assert.equal(mine(s.sid, T0 + 30 * MIN).length, 1);
  assert.equal(mine(s.sid, T0 + 35 * MIN + 1).length, 0);
});

test('background hand-back (attachment form) strips the preamble and marks the subagent done', () => {
  const s = session();
  s.meta('ffff66', { agentType: 'Explore', description: 'bg', toolUseId: 'tu6', requestShape: 'background' });
  writeFileSync(
    s.main,
    jsonl([
      agentToolUse(s.sid, T0, 'tu6', { description: 'bg', subagent_type: 'Explore', prompt: 'p', run_in_background: true }),
      bgLaunch(s.sid, T0 + 100, 'tu6', 'ffff66'),
      handbackAttachment(s.sid, T0 + 30_000, 'ffff66', 'Found 3 issues.'),
    ]),
  );
  writeFileSync(s.agentFile('ffff66'), jsonl([subLine(s.sid, 'ffff66', T0 + 1000)]));
  T.scanTranscripts();
  const [a] = mine(s.sid, T0 + 40_000);
  assert.equal(a.background, true);
  assert.equal(a.state, 'done');
  assert.equal(a.result, 'Found 3 issues.');
});

test('background hand-back in the older user-line form is handled too', () => {
  const s = session();
  s.meta('gggg77', { agentType: 'Explore', description: 'bg', toolUseId: 'tu7', requestShape: 'background' });
  writeFileSync(
    s.main,
    jsonl([
      agentToolUse(s.sid, T0, 'tu7', { description: 'bg', subagent_type: 'Explore', prompt: 'p', run_in_background: true }),
      { type: 'user', sessionId: s.sid, cwd, timestamp: iso(T0 + 30_000), origin: { kind: 'peer', from: 'gggg77', senderTaskId: 'gggg77', body: PREAMBLE + 'Old form report.' } },
    ]),
  );
  writeFileSync(s.agentFile('gggg77'), jsonl([subLine(s.sid, 'gggg77', T0 + 1000)]));
  T.scanTranscripts();
  const [a] = mine(s.sid, T0 + 40_000);
  assert.equal(a.state, 'done');
  assert.equal(a.result, 'Old form report.');
});

test('a completion notice alone marks done with no result, and never overwrites a real report', () => {
  const s = session();
  s.meta('hhhh88', { agentType: 'Explore', description: 'n1', toolUseId: 'tu8', requestShape: 'background' });
  s.meta('iiii99', { agentType: 'Explore', description: 'n2', toolUseId: 'tu9', requestShape: 'background' });
  writeFileSync(
    s.main,
    jsonl([
      agentToolUse(s.sid, T0, 'tu8', { description: 'n1', subagent_type: 'Explore', prompt: 'p', run_in_background: true }),
      agentToolUse(s.sid, T0 + 1, 'tu9', { description: 'n2', subagent_type: 'Explore', prompt: 'p', run_in_background: true }),
      noticeAttachment(s.sid, T0 + 20_000, 'hhhh88'),
      handbackAttachment(s.sid, T0 + 21_000, 'iiii99', 'Real report'),
      noticeAttachment(s.sid, T0 + 22_000, 'iiii99'),
    ]),
  );
  writeFileSync(s.agentFile('hhhh88'), jsonl([subLine(s.sid, 'hhhh88', T0 + 1000)]));
  writeFileSync(s.agentFile('iiii99'), jsonl([subLine(s.sid, 'iiii99', T0 + 1000)]));
  T.scanTranscripts();
  const byId = Object.fromEntries(mine(s.sid, T0 + 30_000).map((x) => [x.agentId, x]));
  assert.equal(byId.hhhh88.state, 'done');
  assert.equal(byId.hhhh88.result, '');
  assert.equal(byId.iiii99.state, 'done');
  assert.equal(byId.iiii99.result, 'Real report');
});

test('without a meta file it falls back to the Agent tool call linked through the agentId, with type "agent" when unknown', () => {
  const s = session();
  writeFileSync(
    s.main,
    jsonl([
      agentToolUse(s.sid, T0, 'tuA', { description: 'from spawn', subagent_type: 'general-purpose', prompt: 'brief' }),
      fgResult(s.sid, T0 + 5000, 'tuA', 'jjjj10', 'done'),
    ]),
  );
  writeFileSync(s.agentFile('jjjj10'), jsonl([subLine(s.sid, 'jjjj10', T0 + 1000)]));
  writeFileSync(s.agentFile('kkkk11'), jsonl([subLine(s.sid, 'kkkk11', T0 + 1000)]));
  T.scanTranscripts();
  const byId = Object.fromEntries(mine(s.sid, T0 + 10_000).map((x) => [x.agentId, x]));
  assert.equal(byId.jjjj10.agentType, 'general-purpose');
  assert.equal(byId.jjjj10.description, 'from spawn');
  assert.equal(byId.jjjj10.prompt, 'brief');
  assert.equal(byId.kkkk11.agentType, 'agent');
  assert.equal(byId.kkkk11.description, '');
  assert.equal(byId.kkkk11.prompt, '');
});

test('a meta file that appears after the first build is picked up on a later build', () => {
  const s = session();
  writeFileSync(s.main, jsonl([agentToolUse(s.sid, T0, 'tuB', { description: 'late', subagent_type: 'Plan', prompt: 'p' })]));
  writeFileSync(s.agentFile('llll12'), jsonl([subLine(s.sid, 'llll12', T0 + 1000)]));
  T.scanTranscripts();
  assert.equal(mine(s.sid, T0 + 2000)[0].agentType, 'agent');
  s.meta('llll12', { agentType: 'Explore', description: 'meta desc', toolUseId: 'tuB', requestShape: 'background' });
  const [a] = mine(s.sid, T0 + 3000);
  assert.equal(a.agentType, 'Explore');
  assert.equal(a.description, 'meta desc');
  assert.equal(a.background, true);
});

test('a corrupt (mid-write) meta file does not crash and is retried', () => {
  const s = session();
  writeFileSync(s.agentFile('mmmm13'), jsonl([subLine(s.sid, 'mmmm13', T0)]));
  writeFileSync(s.agentFile('mmmm13').replace(/\.jsonl$/, '.meta.json'), '{"agentType": "Expl');
  T.scanTranscripts();
  assert.equal(mine(s.sid, T0 + 1000)[0].agentType, 'agent');
  s.meta('mmmm13', { agentType: 'Explore', description: 'ok', toolUseId: 'x' });
  assert.equal(mine(s.sid, T0 + 1000)[0].agentType, 'Explore');
});

test('a nested subagent gets the spawning subagent as parentAgentId, and still belongs to the main session', () => {
  const s = session();
  s.meta('pppp01', { agentType: 'general-purpose', description: 'outer', toolUseId: 'tuP', requestShape: 'foreground' });
  s.meta('cccc02', { agentType: 'Explore', description: 'inner', toolUseId: 'tuC', requestShape: 'foreground' });
  writeFileSync(s.main, jsonl([agentToolUse(s.sid, T0, 'tuP', { description: 'outer', subagent_type: 'general-purpose', prompt: 'p' })]));
  writeFileSync(
    s.agentFile('pppp01'),
    jsonl([
      subLine(s.sid, 'pppp01', T0 + 1000),
      subAssistant(s.sid, 'pppp01', T0 + 2000, 'po1', [{ type: 'tool_use', id: 'tuC', name: 'Agent', input: { description: 'inner', subagent_type: 'Explore', prompt: 'inner brief' } }]),
    ]),
  );
  writeFileSync(s.agentFile('cccc02'), jsonl([subLine(s.sid, 'cccc02', T0 + 3000)]));
  T.scanTranscripts();
  const byId = Object.fromEntries(mine(s.sid, T0 + 10_000).map((x) => [x.agentId, x]));
  assert.equal(byId.pppp01.parentAgentId, null);
  assert.equal(byId.cccc02.parentAgentId, 'pppp01');
  assert.equal(byId.cccc02.sessionId, s.sid);
  assert.equal(byId.cccc02.prompt, 'inner brief');
});

test('tokens are summed per subagent and still counted once under the parent session', () => {
  const s = session();
  writeFileSync(s.main, jsonl([assistantLine({ sessionId: s.sid, cwd, ts: iso(T0), id: 'main1', usage: { output_tokens: 100 } })]));
  writeFileSync(
    s.agentFile('tttt01'),
    jsonl([
      subAssistant(s.sid, 'tttt01', T0 + 1000, 's1', [{ type: 'text', text: 'a' }], { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 }),
      subAssistant(s.sid, 'tttt01', T0 + 2000, 's2', [{ type: 'text', text: 'b' }], { output_tokens: 10 }),
    ]),
  );
  writeFileSync(s.agentFile('tttt02'), jsonl([subAssistant(s.sid, 'tttt02', T0 + 3000, 's3', [{ type: 'text', text: 'c' }], { output_tokens: 5 })]));
  T.scanTranscripts();
  T.scanTranscripts(); // a rescan must not double count
  const byId = Object.fromEntries(mine(s.sid, T0 + 10_000).map((x) => [x.agentId, x]));
  assert.equal(byId.tttt01.tokens, 20);
  assert.equal(byId.tttt02.tokens, 5);
  assert.equal(T.sessionAgg.get(s.sid)!.tokens.output, 100 + 2 + 10 + 5);
  assert.equal(T.sessionAgg.get(s.sid)!.tokens.input, 1);
});

test('keeps only the newest 24 subagents per session', () => {
  const s = session();
  for (let i = 0; i < 30; i++) {
    const id = `many${String(i).padStart(2, '0')}x`;
    writeFileSync(s.agentFile(id), jsonl([subLine(s.sid, id, T0 + i * 1000)]));
  }
  T.scanTranscripts();
  const out = mine(s.sid, T0 + 60_000);
  assert.equal(out.length, 24);
  assert.deepEqual(out.map((x) => x.agentId), Array.from({ length: 24 }, (_, i) => `many${String(i + 6).padStart(2, '0')}x`));
});

test('handedBack is true for foreground and notice-only hand-backs, false when working or merely quiet', () => {
  const s = session();
  s.meta('hb0001', { agentType: 'Explore', description: 'fg', toolUseId: 'tuH1', requestShape: 'foreground' });
  s.meta('hb0002', { agentType: 'Explore', description: 'notice', toolUseId: 'tuH2', requestShape: 'background' });
  s.meta('hb0003', { agentType: 'Explore', description: 'quiet', toolUseId: 'tuH3', requestShape: 'foreground' });
  s.meta('hb0004', { agentType: 'Explore', description: 'busy', toolUseId: 'tuH4', requestShape: 'foreground' });
  writeFileSync(
    s.main,
    jsonl([
      agentToolUse(s.sid, T0, 'tuH1', { description: 'fg', subagent_type: 'Explore', prompt: 'p' }),
      fgResult(s.sid, T0 + 10_000, 'tuH1', 'hb0001', 'report'),
      noticeAttachment(s.sid, T0 + 10_000, 'hb0002'),
    ]),
  );
  writeFileSync(s.agentFile('hb0001'), jsonl([subLine(s.sid, 'hb0001', T0 + 1000)]));
  writeFileSync(s.agentFile('hb0002'), jsonl([subLine(s.sid, 'hb0002', T0 + 1000)]));
  writeFileSync(s.agentFile('hb0003'), jsonl([subLine(s.sid, 'hb0003', T0)]));
  writeFileSync(s.agentFile('hb0004'), jsonl([subLine(s.sid, 'hb0004', T0 + 6 * MIN)]));
  T.scanTranscripts();
  const byId = Object.fromEntries(mine(s.sid, T0 + 6 * MIN + 1000).map((x) => [x.agentId, x]));
  assert.equal(byId.hb0001.state, 'done');
  assert.equal(byId.hb0001.handedBack, true);
  assert.equal(byId.hb0001.result, 'report');
  assert.equal(byId.hb0002.state, 'done');
  assert.equal(byId.hb0002.handedBack, true);
  assert.equal(byId.hb0002.result, '');
  assert.equal(byId.hb0003.state, 'done');
  assert.equal(byId.hb0003.handedBack, false);
  assert.equal(byId.hb0003.result, '');
  assert.equal(byId.hb0004.state, 'working');
  assert.equal(byId.hb0004.handedBack, false);
});

test('a subagent that writes lines after its hand-back is working again; the 10 s slack does not count as resumed', () => {
  const s = session();
  s.meta('rs0001', { agentType: 'Explore', description: 'slack', toolUseId: 'tuR1', requestShape: 'foreground' });
  s.meta('rs0002', { agentType: 'Explore', description: 'resumed', toolUseId: 'tuR2', requestShape: 'foreground' });
  const back = T0 + 30_000;
  writeFileSync(
    s.main,
    jsonl([
      agentToolUse(s.sid, T0, 'tuR1', { description: 'slack', subagent_type: 'Explore', prompt: 'p' }),
      agentToolUse(s.sid, T0 + 1, 'tuR2', { description: 'resumed', subagent_type: 'Explore', prompt: 'p' }),
      fgResult(s.sid, back, 'tuR1', 'rs0001', 'first'),
      fgResult(s.sid, back, 'tuR2', 'rs0002', 'second'),
    ]),
  );
  writeFileSync(s.agentFile('rs0001'), jsonl([subLine(s.sid, 'rs0001', T0 + 1000), subLine(s.sid, 'rs0001', back + 10_000)]));
  writeFileSync(s.agentFile('rs0002'), jsonl([subLine(s.sid, 'rs0002', T0 + 1000), subLine(s.sid, 'rs0002', back + 10_001)]));
  T.scanTranscripts();
  const byId = Object.fromEntries(mine(s.sid, back + 20_000).map((x) => [x.agentId, x]));
  assert.equal(byId.rs0001.state, 'done');
  assert.equal(byId.rs0001.handedBack, true);
  assert.equal(byId.rs0001.result, 'first');
  assert.equal(byId.rs0002.state, 'working');
  assert.equal(byId.rs0002.handedBack, false);
  assert.equal(byId.rs0002.result, '');
});

test('a resumed subagent that then goes quiet for over 5 minutes is done without a hand-back', () => {
  const s = session();
  writeFileSync(s.main, jsonl([fgResult(s.sid, T0 + 1000, 'tuQ', 'rq0001', 'old report')]));
  writeFileSync(s.agentFile('rq0001'), jsonl([subLine(s.sid, 'rq0001', T0 + 60_000)]));
  T.scanTranscripts();
  const [a] = mine(s.sid, T0 + 60_000 + 5 * MIN + 1);
  assert.equal(a.state, 'done');
  assert.equal(a.handedBack, false);
  assert.equal(a.result, '');
});

test('a subagent reports the main session project even when its own lines carry another cwd', () => {
  const s = session();
  const other = join(fx.projectsRoot, 'Beta');
  writeFileSync(s.main, jsonl([assistantLine({ sessionId: s.sid, cwd, ts: iso(T0), id: `main-${s.sid}`, usage: { output_tokens: 1 } })]));
  writeFileSync(s.agentFile('pj0001'), jsonl([subLine(s.sid, 'pj0001', T0 + 1000, { cwd: other })]));
  T.scanTranscripts();
  const [a] = mine(s.sid, T0 + 2000);
  assert.equal(a.project, 'Alpha');
});

test('a meta file that was read successfully is not re-read, even without a toolUseId', () => {
  const s = session();
  writeFileSync(s.agentFile('mt0001'), jsonl([subLine(s.sid, 'mt0001', T0)]));
  s.meta('mt0001', { agentType: 'Explore', description: 'first' });
  T.scanTranscripts();
  assert.equal(mine(s.sid, T0 + 1000)[0].agentType, 'Explore');
  s.meta('mt0001', { agentType: 'Plan', description: 'second' });
  const [a] = mine(s.sid, T0 + 2000);
  assert.equal(a.agentType, 'Explore');
  assert.equal(a.description, 'first');
});

test('a meta file over 64 KB is ignored, falling back to the Agent tool call', () => {
  const s = session();
  s.meta('big001', { agentType: 'FromMeta', description: 'x', padding: 'x'.repeat(70 * 1024) });
  writeFileSync(
    s.main,
    jsonl([
      agentToolUse(s.sid, T0, 'tuBig', { description: 'spawn desc', subagent_type: 'Plan', prompt: 'p' }),
      fgResult(s.sid, T0 + 5000, 'tuBig', 'big001', 'ok'),
    ]),
  );
  writeFileSync(s.agentFile('big001'), jsonl([subLine(s.sid, 'big001', T0 + 1000)]));
  T.scanTranscripts();
  const [a] = mine(s.sid, T0 + 10_000);
  assert.equal(a.agentType, 'Plan');
  assert.equal(a.description, 'spawn desc');
});

test('agentType and description are clipped to 80 and 160 chars from both meta and the Agent tool call', () => {
  const s = session();
  s.meta('cl0001', { agentType: 'T'.repeat(200), description: 'D'.repeat(500), toolUseId: 'tuCl1' });
  writeFileSync(
    s.main,
    jsonl([
      agentToolUse(s.sid, T0, 'tuCl1', { description: 'x', subagent_type: 'x', prompt: 'p' }),
      agentToolUse(s.sid, T0 + 1, 'tuCl2', { description: 'S'.repeat(500), subagent_type: 'U'.repeat(200), prompt: 'p' }),
      fgResult(s.sid, T0 + 5000, 'tuCl2', 'cl0002', 'ok'),
    ]),
  );
  writeFileSync(s.agentFile('cl0001'), jsonl([subLine(s.sid, 'cl0001', T0 + 1000)]));
  writeFileSync(s.agentFile('cl0002'), jsonl([subLine(s.sid, 'cl0002', T0 + 1000)]));
  T.scanTranscripts();
  const byId = Object.fromEntries(mine(s.sid, T0 + 10_000).map((x) => [x.agentId, x]));
  for (const [id, t, d] of [['cl0001', 'T', 'D'], ['cl0002', 'U', 'S']] as const) {
    assert.equal(byId[id].agentType.length, 80, id);
    assert.ok(byId[id].agentType.endsWith('…'), id);
    assert.equal(byId[id].agentType, t.repeat(79) + '…');
    assert.equal(byId[id].description, d.repeat(159) + '…');
  }
});

test('messages feed shows an attachment-form hand-back with the agent name and a clean snippet', () => {
  const s = session();
  writeFileSync(s.main, jsonl([handbackAttachment(s.sid, T0, 'zzzz99', 'All clean.', 'Explore')]));
  T.scanTranscripts();
  const msgs = T.messages.filter((m) => m.sessionId === s.sid);
  assert.equal(msgs.length, 1);
  assert.deepEqual([msgs[0].kind, msgs[0].direction, msgs[0].peer, msgs[0].snippet], ['subagent', 'in', 'Explore', 'All clean.']);
});

test('messages feed keeps the user-line hand-back form and uses from as peer when there is no name', () => {
  const s = session();
  writeFileSync(
    s.main,
    jsonl([{ type: 'user', sessionId: s.sid, cwd, timestamp: iso(T0), origin: { kind: 'peer', from: 'a1b2c3', senderTaskId: 'a1b2c3', body: PREAMBLE + 'Done.' } }]),
  );
  T.scanTranscripts();
  const [m] = T.messages.filter((x) => x.sessionId === s.sid);
  assert.deepEqual([m.kind, m.peer, m.snippet], ['subagent', 'a1b2c3', 'Done.']);
});

test('buildState returns a subagents array, empty for sessions that are not live', async () => {
  const { buildState } = await import('../src/server/state.ts');
  const s = session();
  writeFileSync(s.agentFile('state01'), jsonl([subLine(s.sid, 'state01', Date.now())]));
  T.scanTranscripts();
  const st = buildState();
  assert.ok(Array.isArray(st.subagents));
  // No ~/.claude/sessions file exists for this session id, so it is not live.
  assert.equal(st.subagents.filter((x) => x.sessionId === s.sid).length, 0);
});

test('parseEntries skips sidechain lines unless asked, and shows the brief as the first user entry', () => {
  const lines = [
    JSON.stringify(subLine('s', 'ag1234', T0, { message: { role: 'user', content: 'do the thing' } })),
    JSON.stringify(subAssistant('s', 'ag1234', T0 + 1, 'e1', [{ type: 'text', text: 'working' }, { type: 'tool_use', name: 'Read', input: { file_path: 'a.ts' } }])),
  ];
  assert.deepEqual(parseEntries(lines), []);
  assert.deepEqual(parseEntries(lines, false), []);
  const e = parseEntries(lines, true);
  assert.deepEqual(e.map((x) => [x.role, x.text]), [['user', 'do the thing'], ['assistant', 'working'], ['tool', 'Read: a.ts']]);
});

// --- endpoint ---------------------------------------------------------------

const publicDir = join(fx.root, 'public');
mkdirSync(publicDir);
const server = createDashboardServer({ publicDir });
let port = 0;
before(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
after(() => {
  server.closeAllConnections();
  server.close();
});
const get = (path: string, headers: Record<string, string> = {}) => raw(port, { path, headers: { Host: `127.0.0.1:${port}`, ...headers } });

test('GET /api/subagents/<id>/transcript serves sidechain entries, brief first', async () => {
  const s = session();
  writeFileSync(
    s.agentFile('endp01'),
    jsonl([
      subLine(s.sid, 'endp01', T0, { message: { role: 'user', content: 'the brief text' } }),
      subAssistant(s.sid, 'endp01', T0 + 1000, 'ep1', [{ type: 'text', text: 'on it' }]),
    ]),
  );
  const r = await get('/api/subagents/endp01/transcript');
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.deepEqual(j.entries.slice(0, 2).map((e: { role: string; text: string }) => [e.role, e.text]), [['user', 'the brief text'], ['assistant', 'on it']]);
});

test('subagent transcript endpoint: unknown id is 404, malformed ids never reach a file', async () => {
  const unknown = await get('/api/subagents/nope9999/transcript');
  assert.equal(unknown.status, 404);
  assert.deepEqual(JSON.parse(unknown.body), { error: 'unknown subagent' });
  for (const bad of ['..%2f..%2fsecret', 'abc', '../x', 'a%20b%20c%20d%20e%20f', 'a'.repeat(65)]) {
    const r = await get(`/api/subagents/${bad}/transcript`);
    assert.ok([400, 403, 404].includes(r.status), `${bad} -> ${r.status}`);
    assert.ok(!r.body.includes('"entries"'), bad);
  }
});

test('subagent transcript endpoint follows the same guards as other /api routes', async () => {
  const s = session();
  writeFileSync(s.agentFile('guard01'), jsonl([subLine(s.sid, 'guard01', T0)]));
  assert.equal((await get('/api/subagents/guard01/transcript')).status, 200);
  assert.equal((await raw(port, { path: '/api/subagents/guard01/transcript', headers: { Host: 'evil.example' } })).status, 421);
  assert.equal((await get('/api/subagents/guard01/transcript', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  const post = await raw(port, { method: 'POST', path: '/api/subagents/guard01/transcript', headers: { Host: `127.0.0.1:${port}`, Origin: `http://127.0.0.1:${port}`, 'X-Dashboard': '1' } });
  assert.notEqual(post.status, 200);
});
