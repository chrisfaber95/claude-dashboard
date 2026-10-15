// Subagent hand-backs in the message feed, state, parsed entries and transcript endpoint.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { assistantLine, jsonl, raw } from '../../helpers.ts';
import { fx, transcriptsModule, parseEntries, createDashboardServer, cwd, MIN, T0, iso, session, agentToolUse, subLine, subAssistant, fgResult, PREAMBLE, handbackAttachment, noticeAttachment, live, mine } from './subagents-test-setup.ts';

test('handedBack is true for foreground and notice-only hand-backs, false when working or merely quiet', () => {
  const store = session();
  store.meta('hb0001', { agentType: 'Explore', description: 'fg', toolUseId: 'tuH1', requestShape: 'foreground' });
  store.meta('hb0002', { agentType: 'Explore', description: 'notice', toolUseId: 'tuH2', requestShape: 'background' });
  store.meta('hb0003', { agentType: 'Explore', description: 'quiet', toolUseId: 'tuH3', requestShape: 'foreground' });
  store.meta('hb0004', { agentType: 'Explore', description: 'busy', toolUseId: 'tuH4', requestShape: 'foreground' });
  writeFileSync(
    store.main,
    jsonl([
      agentToolUse(store.sessionId, T0, 'tuH1', { description: 'fg', subagent_type: 'Explore', prompt: 'p' }),
      fgResult(store.sessionId, T0 + 10_000, 'tuH1', 'hb0001', 'report'),
      noticeAttachment(store.sessionId, T0 + 10_000, 'hb0002'),
    ]),
  );
  writeFileSync(store.agentFile('hb0001'), jsonl([subLine(store.sessionId, 'hb0001', T0 + 1000)]));
  writeFileSync(store.agentFile('hb0002'), jsonl([subLine(store.sessionId, 'hb0002', T0 + 1000)]));
  writeFileSync(store.agentFile('hb0003'), jsonl([subLine(store.sessionId, 'hb0003', T0)]));
  writeFileSync(store.agentFile('hb0004'), jsonl([subLine(store.sessionId, 'hb0004', T0 + 6 * MIN)]));
  transcriptsModule.scanTranscripts();
  const byId = Object.fromEntries(mine(store.sessionId, T0 + 6 * MIN + 1000).map((item) => [item.agentId, item]));
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
  const store = session();
  store.meta('rs0001', { agentType: 'Explore', description: 'slack', toolUseId: 'tuR1', requestShape: 'foreground' });
  store.meta('rs0002', { agentType: 'Explore', description: 'resumed', toolUseId: 'tuR2', requestShape: 'foreground' });
  const back = T0 + 30_000;
  writeFileSync(
    store.main,
    jsonl([
      agentToolUse(store.sessionId, T0, 'tuR1', { description: 'slack', subagent_type: 'Explore', prompt: 'p' }),
      agentToolUse(store.sessionId, T0 + 1, 'tuR2', { description: 'resumed', subagent_type: 'Explore', prompt: 'p' }),
      fgResult(store.sessionId, back, 'tuR1', 'rs0001', 'first'),
      fgResult(store.sessionId, back, 'tuR2', 'rs0002', 'second'),
    ]),
  );
  writeFileSync(store.agentFile('rs0001'), jsonl([subLine(store.sessionId, 'rs0001', T0 + 1000), subLine(store.sessionId, 'rs0001', back + 10_000)]));
  writeFileSync(store.agentFile('rs0002'), jsonl([subLine(store.sessionId, 'rs0002', T0 + 1000), subLine(store.sessionId, 'rs0002', back + 10_001)]));
  transcriptsModule.scanTranscripts();
  const byId = Object.fromEntries(mine(store.sessionId, back + 20_000).map((item) => [item.agentId, item]));
  assert.equal(byId.rs0001.state, 'done');
  assert.equal(byId.rs0001.handedBack, true);
  assert.equal(byId.rs0001.result, 'first');
  assert.equal(byId.rs0002.state, 'working');
  assert.equal(byId.rs0002.handedBack, false);
  assert.equal(byId.rs0002.result, '');
});

test('a resumed subagent that then goes quiet for over 5 minutes is done without a hand-back', () => {
  const store = session();
  writeFileSync(store.main, jsonl([fgResult(store.sessionId, T0 + 1000, 'tuQ', 'rq0001', 'old report')]));
  writeFileSync(store.agentFile('rq0001'), jsonl([subLine(store.sessionId, 'rq0001', T0 + 60_000)]));
  transcriptsModule.scanTranscripts();
  const [a] = mine(store.sessionId, T0 + 60_000 + 5 * MIN + 1);
  assert.equal(a.state, 'done');
  assert.equal(a.handedBack, false);
  assert.equal(a.result, '');
});

test('a subagent reports the main session project even when its own lines carry another cwd', () => {
  const store = session();
  const other = join(fx.projectsRoot, 'Beta');
  writeFileSync(store.main, jsonl([assistantLine({ sessionId: store.sessionId, cwd, ts: iso(T0), id: `main-${store.sessionId}`, usage: { output_tokens: 1 } })]));
  writeFileSync(store.agentFile('pj0001'), jsonl([subLine(store.sessionId, 'pj0001', T0 + 1000, { cwd: other })]));
  transcriptsModule.scanTranscripts();
  const [a] = mine(store.sessionId, T0 + 2000);
  assert.equal(a.project, 'Alpha');
});

test('a meta file that was read successfully is not re-read, even without a toolUseId', () => {
  const store = session();
  writeFileSync(store.agentFile('mt0001'), jsonl([subLine(store.sessionId, 'mt0001', T0)]));
  store.meta('mt0001', { agentType: 'Explore', description: 'first' });
  transcriptsModule.scanTranscripts();
  assert.equal(mine(store.sessionId, T0 + 1000)[0].agentType, 'Explore');
  store.meta('mt0001', { agentType: 'Plan', description: 'second' });
  const [a] = mine(store.sessionId, T0 + 2000);
  assert.equal(a.agentType, 'Explore');
  assert.equal(a.description, 'first');
});

test('a meta file over 64 KB is ignored, falling back to the Agent tool call', () => {
  const store = session();
  store.meta('big001', { agentType: 'FromMeta', description: 'x', padding: 'x'.repeat(70 * 1024) });
  writeFileSync(
    store.main,
    jsonl([
      agentToolUse(store.sessionId, T0, 'tuBig', { description: 'spawn desc', subagent_type: 'Plan', prompt: 'p' }),
      fgResult(store.sessionId, T0 + 5000, 'tuBig', 'big001', 'ok'),
    ]),
  );
  writeFileSync(store.agentFile('big001'), jsonl([subLine(store.sessionId, 'big001', T0 + 1000)]));
  transcriptsModule.scanTranscripts();
  const [a] = mine(store.sessionId, T0 + 10_000);
  assert.equal(a.agentType, 'Plan');
  assert.equal(a.description, 'spawn desc');
});

test('agentType and description are clipped to 80 and 160 chars from both meta and the Agent tool call', () => {
  const store = session();
  store.meta('cl0001', { agentType: 'T'.repeat(200), description: 'D'.repeat(500), toolUseId: 'tuCl1' });
  writeFileSync(
    store.main,
    jsonl([
      agentToolUse(store.sessionId, T0, 'tuCl1', { description: 'x', subagent_type: 'x', prompt: 'p' }),
      agentToolUse(store.sessionId, T0 + 1, 'tuCl2', { description: 'S'.repeat(500), subagent_type: 'U'.repeat(200), prompt: 'p' }),
      fgResult(store.sessionId, T0 + 5000, 'tuCl2', 'cl0002', 'ok'),
    ]),
  );
  writeFileSync(store.agentFile('cl0001'), jsonl([subLine(store.sessionId, 'cl0001', T0 + 1000)]));
  writeFileSync(store.agentFile('cl0002'), jsonl([subLine(store.sessionId, 'cl0002', T0 + 1000)]));
  transcriptsModule.scanTranscripts();
  const byId = Object.fromEntries(mine(store.sessionId, T0 + 10_000).map((item) => [item.agentId, item]));
  for (const [id, nowMs, directory] of [['cl0001', 'T', 'D'], ['cl0002', 'U', 'S']] as const) {
    assert.equal(byId[id].agentType.length, 80, id);
    assert.ok(byId[id].agentType.endsWith('…'), id);
    assert.equal(byId[id].agentType, nowMs.repeat(79) + '…');
    assert.equal(byId[id].description, directory.repeat(159) + '…');
  }
});

test('messages feed shows an attachment-form hand-back with the agent name and a clean snippet', () => {
  const store = session();
  writeFileSync(store.main, jsonl([handbackAttachment(store.sessionId, T0, 'zzzz99', 'All clean.', 'Explore')]));
  transcriptsModule.scanTranscripts();
  const msgs = transcriptsModule.messages.filter((message) => message.sessionId === store.sessionId);
  assert.equal(msgs.length, 1);
  assert.deepEqual([msgs[0].kind, msgs[0].direction, msgs[0].peer, msgs[0].snippet], ['subagent', 'in', 'Explore', 'All clean.']);
});

test('messages feed keeps the user-line hand-back form and uses from as peer when there is no name', () => {
  const store = session();
  writeFileSync(
    store.main,
    jsonl([{ type: 'user', sessionId: store.sessionId, cwd, timestamp: iso(T0), origin: { kind: 'peer', from: 'a1b2c3', senderTaskId: 'a1b2c3', body: PREAMBLE + 'Done.' } }]),
  );
  transcriptsModule.scanTranscripts();
  const [message] = transcriptsModule.messages.filter((currentMessage) => currentMessage.sessionId === store.sessionId);
  assert.deepEqual([message.kind, message.peer, message.snippet], ['subagent', 'a1b2c3', 'Done.']);
});

test('a subagent hand-back message carries the agentId of the subagent, session messages carry none', () => {
  const store = session();
  store.meta('mmmm11', { agentType: 'Explore', description: 'bg', toolUseId: 'tuM', requestShape: 'background' });
  writeFileSync(
    store.main,
    jsonl([
      handbackAttachment(store.sessionId, T0 + 30_000, 'mmmm11', 'Report.'),
      { type: 'user', sessionId: store.sessionId, cwd, timestamp: iso(T0 + 31_000), origin: { kind: 'peer', from: 'shopapp-0c', body: 'can you rebase?' } },
    ]),
  );
  writeFileSync(store.agentFile('mmmm11'), jsonl([subLine(store.sessionId, 'mmmm11', T0 + 1000)]));
  transcriptsModule.scanTranscripts();
  const msgs = transcriptsModule.messages.filter((message) => message.sessionId === store.sessionId);
  const handBack = msgs.find((message) => message.kind === 'subagent');
  const [subagent] = mine(store.sessionId, T0 + 40_000);
  assert.equal(handBack?.agentId, subagent.agentId);
  assert.equal(handBack?.agentId, 'mmmm11');
  assert.equal(msgs.find((message) => message.kind === 'session')?.agentId, undefined);
});

test('buildState returns a subagents array, empty for sessions that are not live', async () => {
  const { buildState } = await import('../../../src/server/transcripts/state.ts');
  const store = session();
  writeFileSync(store.agentFile('state01'), jsonl([subLine(store.sessionId, 'state01', Date.now())]));
  transcriptsModule.scanTranscripts();
  const liveState = buildState();
  assert.ok(Array.isArray(liveState.subagents));
  // No ~/.claude/sessions file exists for this session id, so it is not live.
  assert.equal(liveState.subagents.filter((subagent) => subagent.sessionId === store.sessionId).length, 0);
});

test('parseEntries skips sidechain lines unless asked, and shows the brief as the first user entry', () => {
  const lines = [
    JSON.stringify(subLine('s', 'ag1234', T0, { message: { role: 'user', content: 'do the thing' } })),
    JSON.stringify(subAssistant('s', 'ag1234', T0 + 1, 'e1', [{ type: 'text', text: 'working' }, { type: 'tool_use', name: 'Read', input: { file_path: 'a.ts' } }])),
  ];
  assert.deepEqual(parseEntries(lines), []);
  assert.deepEqual(parseEntries(lines, false), []);
  const entry = parseEntries(lines, true);
  assert.deepEqual(entry.map((item) => [item.role, item.text]), [['user', 'do the thing'], ['assistant', 'working'], ['tool', 'Read: a.ts']]);
});

// --- endpoint ---------------------------------------------------------------

const publicDir = join(fx.root, 'public');
mkdirSync(publicDir);
const server = createDashboardServer({ publicDir });
let port = 0;
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});
after(() => {
  server.closeAllConnections();
  server.close();
});
const get = (path: string, headers: Record<string, string> = {}) => raw(port, { path, headers: { Host: `127.0.0.1:${port}`, ...headers } });

test('GET /api/subagents/<id>/transcript serves sidechain entries, brief first', async () => {
  const store = session();
  writeFileSync(
    store.agentFile('endp01'),
    jsonl([
      subLine(store.sessionId, 'endp01', T0, { message: { role: 'user', content: 'the brief text' } }),
      subAssistant(store.sessionId, 'endp01', T0 + 1000, 'ep1', [{ type: 'text', text: 'on it' }]),
    ]),
  );
  const response = await get('/api/subagents/endp01/transcript');
  assert.equal(response.status, 200);
  const j = JSON.parse(response.body);
  assert.deepEqual(j.entries.slice(0, 2).map((entry: { role: string; text: string }) => [entry.role, entry.text]), [['user', 'the brief text'], ['assistant', 'on it']]);
});

test('subagent transcript endpoint: unknown id is 404, malformed ids never reach a file', async () => {
  const unknown = await get('/api/subagents/nope9999/transcript');
  assert.equal(unknown.status, 404);
  assert.deepEqual(JSON.parse(unknown.body), { error: 'unknown subagent' });
  for (const bad of ['..%2f..%2fsecret', 'abc', '../x', 'a%20b%20c%20d%20e%20f', 'a'.repeat(65)]) {
    const response = await get(`/api/subagents/${bad}/transcript`);
    assert.ok([400, 403, 404].includes(response.status), `${bad} -> ${response.status}`);
    assert.ok(!response.body.includes('"entries"'), bad);
  }
});

test('subagent transcript endpoint follows the same guards as other /api routes', async () => {
  const store = session();
  writeFileSync(store.agentFile('guard01'), jsonl([subLine(store.sessionId, 'guard01', T0)]));
  assert.equal((await get('/api/subagents/guard01/transcript')).status, 200);
  assert.equal((await raw(port, { path: '/api/subagents/guard01/transcript', headers: { Host: 'evil.example' } })).status, 421);
  assert.equal((await get('/api/subagents/guard01/transcript', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  const post = await raw(port, { method: 'POST', path: '/api/subagents/guard01/transcript', headers: { Host: `127.0.0.1:${port}`, Origin: `http://127.0.0.1:${port}`, 'X-Dashboard': '1' } });
  assert.notEqual(post.status, 200);
});
