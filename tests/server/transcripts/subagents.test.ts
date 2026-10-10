// Subagent status, hand-back detection, metadata and clipping.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { assistantLine, jsonl } from '../../helpers.ts';
import { transcriptsModule, cwd, MIN, T0, iso, session, agentToolUse, subLine, subAssistant, fgResult, bgLaunch, PREAMBLE, handbackAttachment, noticeAttachment, live, mine } from './subagents-test-setup.ts';

test('a subagent with recent activity and no hand-back is working, with its latest tool call', () => {
  const store = session();
  store.meta('aaaa11', { agentType: 'Explore', description: 'look around', toolUseId: 'tu1', spawnDepth: 1, requestShape: 'foreground' });
  writeFileSync(store.main, jsonl([agentToolUse(store.sessionId, T0, 'tu1', { description: 'look around', subagent_type: 'Explore', prompt: 'find things', run_in_background: false })]));
  writeFileSync(
    store.agentFile('aaaa11'),
    jsonl([
      subLine(store.sessionId, 'aaaa11', T0 + 1000),
      subAssistant(store.sessionId, 'aaaa11', T0 + 2000, 'x1', [{ type: 'tool_use', id: 't', name: 'Read', input: { file_path: 'src/a.ts' } }]),
    ]),
  );
  transcriptsModule.scanTranscripts();
  const [a] = mine(store.sessionId, T0 + MIN);
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
  const store = session();
  store.meta('bbbb22', { agentType: 'Explore', description: 'd', toolUseId: 'tu2', requestShape: 'foreground' });
  writeFileSync(store.main, jsonl([agentToolUse(store.sessionId, T0, 'tu2', { description: 'd', subagent_type: 'Explore', prompt: 'p' })]));
  writeFileSync(store.agentFile('bbbb22'), jsonl([subLine(store.sessionId, 'bbbb22', T0)]));
  transcriptsModule.scanTranscripts();

  assert.equal(mine(store.sessionId, T0 + 5 * MIN - 1)[0].state, 'working');
  const stale = mine(store.sessionId, T0 + 5 * MIN + 1)[0];
  assert.equal(stale.state, 'done');
  assert.equal(stale.result, '');
  assert.equal(stale.activity, '');
  assert.equal(mine(store.sessionId, T0 + 15 * MIN - 1).length, 1);
  assert.equal(mine(store.sessionId, T0 + 15 * MIN + 1).length, 0);
});

test('subagents of sessions that are not live are excluded', () => {
  const store = session();
  writeFileSync(store.agentFile('cccc33'), jsonl([subLine(store.sessionId, 'cccc33', T0)]));
  transcriptsModule.scanTranscripts();
  assert.equal(transcriptsModule.buildSubagents(live('some-other-session'), T0 + 1000).filter((subagent) => subagent.sessionId === store.sessionId).length, 0);
  assert.equal(transcriptsModule.buildSubagents(live(store.sessionId), T0 + 1000).filter((subagent) => subagent.sessionId === store.sessionId).length, 1);
});

test('foreground completion marks the subagent done and clips the result to 300 chars', () => {
  const store = session();
  store.meta('dddd44', { agentType: 'Explore', description: 'd', toolUseId: 'tu4', requestShape: 'foreground' });
  const long = 'word '.repeat(200);
  writeFileSync(
    store.main,
    jsonl([agentToolUse(store.sessionId, T0, 'tu4', { description: 'd', subagent_type: 'Explore', prompt: 'p' }), fgResult(store.sessionId, T0 + 10_000, 'tu4', 'dddd44', long)]),
  );
  writeFileSync(store.agentFile('dddd44'), jsonl([subLine(store.sessionId, 'dddd44', T0 + 1000)]));
  transcriptsModule.scanTranscripts();
  const [a] = mine(store.sessionId, T0 + 20_000);
  assert.equal(a.state, 'done');
  assert.ok(a.result.length <= 300, `length ${a.result.length}`);
  assert.ok(a.result.length > 250);
  assert.ok(a.result.endsWith('…'));
  assert.equal(a.activity, '');
});

test('a done subagent is dropped 15 minutes after its hand-back, not after its last line', () => {
  const store = session();
  store.meta('eeee55', { agentType: 'Explore', description: 'd', toolUseId: 'tu5', requestShape: 'foreground' });
  writeFileSync(
    store.main,
    jsonl([agentToolUse(store.sessionId, T0, 'tu5', { description: 'd', subagent_type: 'Explore', prompt: 'p' }), fgResult(store.sessionId, T0 + 20 * MIN, 'tu5', 'eeee55', 'ok')]),
  );
  writeFileSync(store.agentFile('eeee55'), jsonl([subLine(store.sessionId, 'eeee55', T0)]));
  transcriptsModule.scanTranscripts();
  assert.equal(mine(store.sessionId, T0 + 30 * MIN).length, 1);
  assert.equal(mine(store.sessionId, T0 + 35 * MIN + 1).length, 0);
});

test('background hand-back (attachment form) strips the preamble and marks the subagent done', () => {
  const store = session();
  store.meta('ffff66', { agentType: 'Explore', description: 'bg', toolUseId: 'tu6', requestShape: 'background' });
  writeFileSync(
    store.main,
    jsonl([
      agentToolUse(store.sessionId, T0, 'tu6', { description: 'bg', subagent_type: 'Explore', prompt: 'p', run_in_background: true }),
      bgLaunch(store.sessionId, T0 + 100, 'tu6', 'ffff66'),
      handbackAttachment(store.sessionId, T0 + 30_000, 'ffff66', 'Found 3 issues.'),
    ]),
  );
  writeFileSync(store.agentFile('ffff66'), jsonl([subLine(store.sessionId, 'ffff66', T0 + 1000)]));
  transcriptsModule.scanTranscripts();
  const [a] = mine(store.sessionId, T0 + 40_000);
  assert.equal(a.background, true);
  assert.equal(a.state, 'done');
  assert.equal(a.result, 'Found 3 issues.');
});

test('background hand-back in the older user-line form is handled too', () => {
  const store = session();
  store.meta('gggg77', { agentType: 'Explore', description: 'bg', toolUseId: 'tu7', requestShape: 'background' });
  writeFileSync(
    store.main,
    jsonl([
      agentToolUse(store.sessionId, T0, 'tu7', { description: 'bg', subagent_type: 'Explore', prompt: 'p', run_in_background: true }),
      { type: 'user', sessionId: store.sessionId, cwd, timestamp: iso(T0 + 30_000), origin: { kind: 'peer', from: 'gggg77', senderTaskId: 'gggg77', body: PREAMBLE + 'Old form report.' } },
    ]),
  );
  writeFileSync(store.agentFile('gggg77'), jsonl([subLine(store.sessionId, 'gggg77', T0 + 1000)]));
  transcriptsModule.scanTranscripts();
  const [a] = mine(store.sessionId, T0 + 40_000);
  assert.equal(a.state, 'done');
  assert.equal(a.result, 'Old form report.');
});

test('a completion notice alone marks done with no result, and never overwrites a real report', () => {
  const store = session();
  store.meta('hhhh88', { agentType: 'Explore', description: 'n1', toolUseId: 'tu8', requestShape: 'background' });
  store.meta('iiii99', { agentType: 'Explore', description: 'n2', toolUseId: 'tu9', requestShape: 'background' });
  writeFileSync(
    store.main,
    jsonl([
      agentToolUse(store.sessionId, T0, 'tu8', { description: 'n1', subagent_type: 'Explore', prompt: 'p', run_in_background: true }),
      agentToolUse(store.sessionId, T0 + 1, 'tu9', { description: 'n2', subagent_type: 'Explore', prompt: 'p', run_in_background: true }),
      noticeAttachment(store.sessionId, T0 + 20_000, 'hhhh88'),
      handbackAttachment(store.sessionId, T0 + 21_000, 'iiii99', 'Real report'),
      noticeAttachment(store.sessionId, T0 + 22_000, 'iiii99'),
    ]),
  );
  writeFileSync(store.agentFile('hhhh88'), jsonl([subLine(store.sessionId, 'hhhh88', T0 + 1000)]));
  writeFileSync(store.agentFile('iiii99'), jsonl([subLine(store.sessionId, 'iiii99', T0 + 1000)]));
  transcriptsModule.scanTranscripts();
  const byId = Object.fromEntries(mine(store.sessionId, T0 + 30_000).map((item) => [item.agentId, item]));
  assert.equal(byId.hhhh88.state, 'done');
  assert.equal(byId.hhhh88.result, '');
  assert.equal(byId.iiii99.state, 'done');
  assert.equal(byId.iiii99.result, 'Real report');
});

test('without a meta file it falls back to the Agent tool call linked through the agentId, with type "agent" when unknown', () => {
  const store = session();
  writeFileSync(
    store.main,
    jsonl([
      agentToolUse(store.sessionId, T0, 'tuA', { description: 'from spawn', subagent_type: 'general-purpose', prompt: 'brief' }),
      fgResult(store.sessionId, T0 + 5000, 'tuA', 'jjjj10', 'done'),
    ]),
  );
  writeFileSync(store.agentFile('jjjj10'), jsonl([subLine(store.sessionId, 'jjjj10', T0 + 1000)]));
  writeFileSync(store.agentFile('kkkk11'), jsonl([subLine(store.sessionId, 'kkkk11', T0 + 1000)]));
  transcriptsModule.scanTranscripts();
  const byId = Object.fromEntries(mine(store.sessionId, T0 + 10_000).map((item) => [item.agentId, item]));
  assert.equal(byId.jjjj10.agentType, 'general-purpose');
  assert.equal(byId.jjjj10.description, 'from spawn');
  assert.equal(byId.jjjj10.prompt, 'brief');
  assert.equal(byId.kkkk11.agentType, 'agent');
  assert.equal(byId.kkkk11.description, '');
  assert.equal(byId.kkkk11.prompt, '');
});

test('a meta file that appears after the first build is picked up on a later build', () => {
  const store = session();
  writeFileSync(store.main, jsonl([agentToolUse(store.sessionId, T0, 'tuB', { description: 'late', subagent_type: 'Plan', prompt: 'p' })]));
  writeFileSync(store.agentFile('llll12'), jsonl([subLine(store.sessionId, 'llll12', T0 + 1000)]));
  transcriptsModule.scanTranscripts();
  assert.equal(mine(store.sessionId, T0 + 2000)[0].agentType, 'agent');
  store.meta('llll12', { agentType: 'Explore', description: 'meta desc', toolUseId: 'tuB', requestShape: 'background' });
  const [a] = mine(store.sessionId, T0 + 3000);
  assert.equal(a.agentType, 'Explore');
  assert.equal(a.description, 'meta desc');
  assert.equal(a.background, true);
});

test('a corrupt (mid-write) meta file does not crash and is retried', () => {
  const store = session();
  writeFileSync(store.agentFile('mmmm13'), jsonl([subLine(store.sessionId, 'mmmm13', T0)]));
  writeFileSync(store.agentFile('mmmm13').replace(/\.jsonl$/, '.meta.json'), '{"agentType": "Expl');
  transcriptsModule.scanTranscripts();
  assert.equal(mine(store.sessionId, T0 + 1000)[0].agentType, 'agent');
  store.meta('mmmm13', { agentType: 'Explore', description: 'ok', toolUseId: 'x' });
  assert.equal(mine(store.sessionId, T0 + 1000)[0].agentType, 'Explore');
});

test('a nested subagent gets the spawning subagent as parentAgentId, and still belongs to the main session', () => {
  const store = session();
  store.meta('pppp01', { agentType: 'general-purpose', description: 'outer', toolUseId: 'tuP', requestShape: 'foreground' });
  store.meta('cccc02', { agentType: 'Explore', description: 'inner', toolUseId: 'tuC', requestShape: 'foreground' });
  writeFileSync(store.main, jsonl([agentToolUse(store.sessionId, T0, 'tuP', { description: 'outer', subagent_type: 'general-purpose', prompt: 'p' })]));
  writeFileSync(
    store.agentFile('pppp01'),
    jsonl([
      subLine(store.sessionId, 'pppp01', T0 + 1000),
      subAssistant(store.sessionId, 'pppp01', T0 + 2000, 'po1', [{ type: 'tool_use', id: 'tuC', name: 'Agent', input: { description: 'inner', subagent_type: 'Explore', prompt: 'inner brief' } }]),
    ]),
  );
  writeFileSync(store.agentFile('cccc02'), jsonl([subLine(store.sessionId, 'cccc02', T0 + 3000)]));
  transcriptsModule.scanTranscripts();
  const byId = Object.fromEntries(mine(store.sessionId, T0 + 10_000).map((item) => [item.agentId, item]));
  assert.equal(byId.pppp01.parentAgentId, null);
  assert.equal(byId.cccc02.parentAgentId, 'pppp01');
  assert.equal(byId.cccc02.sessionId, store.sessionId);
  assert.equal(byId.cccc02.prompt, 'inner brief');
});

test('tokens are summed per subagent and still counted once under the parent session', () => {
  const store = session();
  writeFileSync(store.main, jsonl([assistantLine({ sessionId: store.sessionId, cwd, ts: iso(T0), id: 'main1', usage: { output_tokens: 100 } })]));
  writeFileSync(
    store.agentFile('tttt01'),
    jsonl([
      subAssistant(store.sessionId, 'tttt01', T0 + 1000, 's1', [{ type: 'text', text: 'a' }], { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 }),
      subAssistant(store.sessionId, 'tttt01', T0 + 2000, 's2', [{ type: 'text', text: 'b' }], { output_tokens: 10 }),
    ]),
  );
  writeFileSync(store.agentFile('tttt02'), jsonl([subAssistant(store.sessionId, 'tttt02', T0 + 3000, 's3', [{ type: 'text', text: 'c' }], { output_tokens: 5 })]));
  transcriptsModule.scanTranscripts();
  transcriptsModule.scanTranscripts(); // a rescan must not double count
  const byId = Object.fromEntries(mine(store.sessionId, T0 + 10_000).map((item) => [item.agentId, item]));
  assert.equal(byId.tttt01.tokens, 20);
  assert.equal(byId.tttt02.tokens, 5);
  assert.equal(transcriptsModule.sessionAgg.get(store.sessionId)!.tokens.output, 100 + 2 + 10 + 5);
  assert.equal(transcriptsModule.sessionAgg.get(store.sessionId)!.tokens.input, 1);
});

test('keeps only the newest 24 subagents per session', () => {
  const store = session();
  for (let i = 0; i < 30; i++) {
    const id = `many${String(i).padStart(2, '0')}x`;
    writeFileSync(store.agentFile(id), jsonl([subLine(store.sessionId, id, T0 + i * 1000)]));
  }
  transcriptsModule.scanTranscripts();
  const out = mine(store.sessionId, T0 + 60_000);
  assert.equal(out.length, 24);
  assert.deepEqual(out.map((item) => item.agentId), Array.from({ length: 24 }, (_, i) => `many${String(i + 6).padStart(2, '0')}x`));
});
