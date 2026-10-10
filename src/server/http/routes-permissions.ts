import { PC_DEVICE } from '../auth/auth.ts';
import { CommandError, audit } from '../claude/claude-cli.ts';
import { APPROVAL_TEXT_AUDIT_MAX } from '../features/permissions/permissions.ts';
import type { RouteHandler } from './context.ts';
import { readJson } from './request-body.ts';
import { send } from './respond.ts';

const ANSWER_PATH_RE = /^\/api\/permissions\/([0-9a-f-]{36})$/;

/**
 * Allow or deny one pending permission request, once. Same guards as the other controls (commands enabled, same-origin
 * POST), but only a paired device may answer: a request from this PC (loopback) is refused even with browser-looking
 * headers, and so is any request whose socket peer is this PC (a minted device with a forged Host), so a session on
 * this PC cannot answer its own request. There is no "always allow" and no bypass: only
 * `allow` and `deny` exist.
 */
export const handlePermissionRoutes: RouteHandler = async (context, call) => {
  const match = call.url.pathname.match(ANSWER_PATH_RE);
  if (!match || call.method !== 'POST') return false;
  if (!context.areCommandsEnabled) throw new CommandError(404, 'commands are disabled');
  if (!call.who || call.who.deviceId === PC_DEVICE || context.isLocalPeer(call.req)) {
    throw new CommandError(403, 'answering needs a paired device');
  }
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
