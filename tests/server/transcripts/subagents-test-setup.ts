// Shared transcript fixtures for the subagent test suites.
import { beforeEach } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assistantLine, makeFixture, transcriptDir } from '../../helpers.ts';


export const fx = makeFixture();
export const transcriptsModule = await import('../../../src/server/transcripts/transcripts.ts');
export const { parseEntries } = await import('../../../src/server/transcripts/transcript-view.ts');
export const { createDashboardServer } = await import('../../../src/server/server.ts');

export const cwd = join(fx.projectsRoot, 'Alpha');
export const MIN = 60_000;
export const T0 = Date.parse('2026-10-01T10:00:00Z');
export const iso = (ms: number) => new Date(ms).toISOString();
export let index = 0;

/** A fresh session folder so tests stay independent; returns ids and writers. */
export function session() {
  const sessionId = `sess-${++index}`;
  const dir = transcriptDir(fx, cwd);
  const subDir = join(dir, sessionId, 'subagents');
  mkdirSync(subDir, { recursive: true });
  const main = join(dir, `${sessionId}.jsonl`);
  const agentFile = (id: string) => join(subDir, `agent-${id}.jsonl`);
  const meta = (id: string, metadata: object) => writeFileSync(join(subDir, `agent-${id}.meta.json`), JSON.stringify(metadata));
  return { sessionId, main, agentFile, meta };
}

export const agentToolUse = (currentSessionId: string, ts: number, toolUseId: string, input: object) =>
  assistantLine({
    sessionId: currentSessionId, cwd, ts: iso(ts), id: `m-${toolUseId}`,
    content: [{ type: 'tool_use', id: toolUseId, name: 'Agent', input }],
  });

export const subLine = (currentSessionId: string, agentId: string, ts: number, over: object = {}) => ({
  type: 'user', isSidechain: true, agentId, sessionId: currentSessionId, cwd, timestamp: iso(ts), uuid: `u-${agentId}-${ts}`,
  message: { role: 'user', content: 'the brief' },
  ...over,
});
export const subAssistant = (currentSessionId: string, agentId: string, ts: number, id: string, content: unknown[], usage?: object) => ({
  ...assistantLine({ sessionId: currentSessionId, cwd, ts: iso(ts), id, content, usage }),
  isSidechain: true, agentId, uuid: `a-${id}`,
});

export const fgResult = (currentSessionId: string, ts: number, toolUseId: string, agentId: string, text: string) => ({
  type: 'user', sessionId: currentSessionId, cwd, timestamp: iso(ts),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: text }] },
  toolUseResult: { status: 'completed', agentId, agentType: 'Explore', content: [{ type: 'text', text }], totalTokens: 5 },
});
export const bgLaunch = (currentSessionId: string, ts: number, toolUseId: string, agentId: string) => ({
  type: 'user', sessionId: currentSessionId, cwd, timestamp: iso(ts),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'launched' }] },
  toolUseResult: { status: 'async_launched', agentId, isAsync: true },
});
export const PREAMBLE = '[Subagent hand-back] This is an automatic message from a background agent. The report follows:\n  ';
export const handbackAttachment = (currentSessionId: string, ts: number, agentId: string, report: string, name = 'Explore') => ({
  type: 'attachment', sessionId: currentSessionId, cwd, timestamp: iso(ts),
  attachment: { type: 'queued_command', origin: { kind: 'peer', from: agentId, senderTaskId: agentId, name, body: PREAMBLE + report, handback: true } },
});
export const noticeAttachment = (currentSessionId: string, ts: number, agentId: string) => ({
  type: 'attachment', sessionId: currentSessionId, cwd, timestamp: iso(ts),
  attachment: { type: 'queued_command', prompt: `<task-notification>\n<task-id>${agentId}</task-id>\n<status>completed</status>\n</task-notification>` },
});

export const live = (...ids: string[]) => new Set(ids);
export const mine = (currentSessionId: string, now: number) => transcriptsModule.buildSubagents(live(currentSessionId), now).filter((subagent) => subagent.sessionId === currentSessionId);

beforeEach(() => transcriptsModule.resetTranscripts());
