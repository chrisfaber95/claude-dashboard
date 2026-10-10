import { CommandError, audit } from '../claude/claude-cli.ts';
import { APPROVAL_TEXT_AUDIT_MAX } from '../features/permissions/permissions.ts';
import type { RouteHandler } from './context.ts';
import { readJson } from './request-body.ts';
import { send } from './respond.ts';

const ANSWER_PATH_RE = /^\/api\/permissions\/([0-9a-f-]{36})$/;

/**
 * Allow or deny one pending permission request, once. Same access as the other controls (signed-in device, commands
 * enabled, same-origin POST). There is no "always allow" and no bypass: only `allow` and `deny` exist.
 */
export const handlePermissionRoutes: RouteHandler = async (context, call) => {
  const match = call.url.pathname.match(ANSWER_PATH_RE);
  if (!match || call.method !== 'POST') return false;
  if (!context.areCommandsEnabled) throw new CommandError(404, 'commands are disabled');
  const body = await readJson(call.req);
  if (body.decision !== 'allow' && body.decision !== 'deny') throw new CommandError(400, 'decision must be allow or deny');
  const result = context.permissions.answer(match[1], body.decision);
  if (result.outcome === 'unknown') throw new CommandError(404, 'unknown permission request');
  if (result.outcome === 'settled') throw new CommandError(409, 'permission request already answered or expired');
  const { request } = result;
  audit({
    ip: call.ip,
    ...call.actor,
    action: 'approval',
    outcome: body.decision,
    id: request.id,
    session: request.sessionId,
    tool: request.tool,
    text: request.text.slice(0, APPROVAL_TEXT_AUDIT_MAX),
  });
  send(call.res, 200, { ok: true });
  return true;
};
