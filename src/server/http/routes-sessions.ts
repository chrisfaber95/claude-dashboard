import { UUID_RE } from '../config.ts';
import {
  CommandError,
  audit,
  continueSession,
  sessionLogs,
  stopSession,
  validateMode,
  validatePrompt,
} from '../claude/claude-cli.ts';
import { summarize } from '../claude/session-summary.ts';
import { getSummaryMode } from '../features/settings/settings.ts';
import { readSessions } from '../transcripts/state.ts';
import { readTranscriptPage } from '../transcripts/transcript-view.ts';
import { scanTranscripts, subagentPaths, transcriptIndex } from '../transcripts/transcripts.ts';
import type { AuthedCall, RouteHandler, ServerContext } from './context.ts';
import { isInsideProject } from './project-folders.ts';
import { readJson } from './request-body.ts';
import { send } from './respond.ts';

const PAGE_LIMIT_DEFAULT = 100;
const PAGE_LIMIT_MAX = 500;
const PROMPT_AUDIT_MAX = 200;
/** After stopping an idle session, wait up to STOP_WAIT_ATTEMPTS x STOP_WAIT_INTERVAL_MS for it to disappear. */
const STOP_WAIT_ATTEMPTS = 25;
const STOP_WAIT_INTERVAL_MS = 200;
const SUBAGENT_RE = /^\/api\/subagents\/([A-Za-z0-9_-]{6,64})\/transcript$/;
const SESSION_ACTION_RE = /^\/api\/sessions\/([^/]+)\/(transcript|summary|logs|message|stop)$/;

/** Session ids with a follow-up in flight. */
const continuingSessionIds = new Set<string>();

function pageLimit(call: AuthedCall): number {
  return Math.min(PAGE_LIMIT_MAX, Math.max(1, Number(call.url.searchParams.get('limit')) || PAGE_LIMIT_DEFAULT));
}

function pause(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/** Look a session up in the transcript index; 400 for a malformed id, 404 for an unknown one. */
function findTranscript(sessionId: string) {
  if (!UUID_RE.test(sessionId)) throw new CommandError(400, 'invalid session id');
  scanTranscripts();
  const transcript = transcriptIndex.get(sessionId);
  if (!transcript) throw new CommandError(404, 'unknown session');
  return transcript;
}

async function sendSubagentTranscript(subagentId: string, call: AuthedCall): Promise<void> {
  scanTranscripts();
  // The path comes from the scanner's index, never from the request.
  const path = subagentPaths.get(subagentId);
  if (!path) throw new CommandError(404, 'unknown subagent');
  const before = call.url.searchParams.get('before') ?? undefined;
  send(call.res, 200, await readTranscriptPage(path, pageLimit(call), before, undefined, true));
}

async function sendSummary(context: ServerContext, sessionId: string, call: AuthedCall): Promise<void> {
  const transcript = findTranscript(sessionId);
  const live = readSessions().find((session) => session.sessionId === sessionId);
  const mode = context.areCommandsEnabled ? getSummaryMode() : 'recap';
  const liveInfo = live && { status: live.status, startedAtMs: live.startedAtMs };
  const onAudit = (isOk: boolean) => audit({ ip: call.ip, ...call.actor, action: 'summary', session: sessionId, ok: isOk });
  send(call.res, 200, await summarize(transcript.path, mode, liveInfo, { cwd: context.projectsRoot, onAudit }));
}

async function stopRunningSession(context: ServerContext, sessionId: string, call: AuthedCall): Promise<void> {
  const result = await stopSession(sessionId, context.projectsRoot);
  audit({ ip: call.ip, ...call.actor, action: 'stop', session: sessionId, ok: result.ok });
  send(call.res, 200, result);
}

/**
 * `--bg --resume` on a running session starts a *copy* with a new id. To keep the same session, an idle background
 * session is stopped first (its conversation is kept).
 */
async function stopIdleSessionFirst(context: ServerContext, sessionId: string, call: AuthedCall): Promise<void> {
  const live = readSessions().find((session) => session.sessionId === sessionId);
  if (!live) return;
  if (live.kind !== 'bg') throw new CommandError(409, 'This session is open in a terminal or editor. Send the message there.');
  if (live.status !== 'idle') throw new CommandError(409, 'This session is busy or waiting. Wait until it is idle, then send the message.');
  const stopped = await stopSession(sessionId, context.projectsRoot);
  audit({ ip: call.ip, ...call.actor, action: 'stop', via: 'message', session: sessionId, ok: stopped.ok });
  const isLive = () => readSessions().some((session) => session.sessionId === sessionId);
  for (let attempt = 0; attempt < STOP_WAIT_ATTEMPTS && isLive(); attempt++) await pause(STOP_WAIT_INTERVAL_MS);
  // Still running: resuming now would start a copy, so give up. (A failed stop of a session that exited on its own is fine.)
  if (isLive()) throw new CommandError(stopped.ok ? 504 : 502, 'The session did not stop. Try again.');
}

async function sendFollowUp(context: ServerContext, sessionId: string, call: AuthedCall): Promise<void> {
  const body = await readJson(call.req);
  const prompt = validatePrompt(body.prompt);
  const mode = validateMode(body.permissionMode);
  const transcript = findTranscript(sessionId);
  if (!isInsideProject(transcript.cwd, context.projectsRoot)) {
    throw new CommandError(403, 'session folder is outside the projects folder');
  }
  // One follow-up at a time per session: concurrent ones would each stop/resume it or start copies.
  if (continuingSessionIds.has(sessionId)) throw new CommandError(409, 'A message to this session is already being sent.');
  continuingSessionIds.add(sessionId);
  try {
    await stopIdleSessionFirst(context, sessionId, call);
    const result = await continueSession(sessionId, transcript.cwd, prompt, mode, context.getSettingsFile());
    const auditedPrompt = prompt.slice(0, PROMPT_AUDIT_MAX);
    audit({ ip: call.ip, ...call.actor, action: 'message', session: sessionId, project: transcript.project, mode, prompt: auditedPrompt, ok: result.ok });
    send(call.res, 200, result);
  } finally {
    continuingSessionIds.delete(sessionId);
  }
}

/** Transcript, summary, logs, follow-up message and stop of one session, and subagent transcripts. */
export const handleSessionRoutes: RouteHandler = async (context, call) => {
  const { url, method, res } = call;
  const subagentMatch = url.pathname.match(SUBAGENT_RE);
  if (subagentMatch && method === 'GET') {
    await sendSubagentTranscript(subagentMatch[1], call);
    return true;
  }
  const match = url.pathname.match(SESSION_ACTION_RE);
  if (!match) return false;
  const [, sessionId, action] = match;
  if (action === 'transcript' && method === 'GET') {
    const transcript = findTranscript(sessionId);
    const before = url.searchParams.get('before') ?? undefined;
    send(res, 200, await readTranscriptPage(transcript.path, pageLimit(call), before));
    return true;
  }
  if (action === 'summary' && method === 'GET') {
    await sendSummary(context, sessionId, call);
    return true;
  }
  if (!context.areCommandsEnabled) throw new CommandError(404, 'commands are disabled');
  // stop/logs only address a background session by id; run them from the projects root.
  if (action === 'logs' && method === 'GET') {
    send(res, 200, await sessionLogs(sessionId, context.projectsRoot));
    return true;
  }
  if (action === 'stop' && method === 'POST') {
    await stopRunningSession(context, sessionId, call);
    return true;
  }
  if (action === 'message' && method === 'POST') {
    await sendFollowUp(context, sessionId, call);
    return true;
  }
  return false;
};
