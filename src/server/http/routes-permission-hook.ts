import { UUID_RE } from '../config.ts';
import { CommandError, audit } from '../claude/claude-cli.ts';
import { requestText } from '../features/permissions/permissions.ts';
import type { RequestCall, ServerContext } from './context.ts';
import { readJson } from './request-body.ts';
import { send } from './respond.ts';

const HOOK_PATH = '/hook/permission';
const LOOPBACK_ADDRESSES = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
const TOOL_NAME_MAX = 100;

async function holdRequest(context: ServerContext, call: RequestCall): Promise<void> {
  const body = await readJson(call.req);
  if (typeof body.sessionId !== 'string' || !UUID_RE.test(body.sessionId)) throw new CommandError(400, 'invalid session id');
  if (typeof body.tool !== 'string' || !body.tool || body.tool.length > TOOL_NAME_MAX) throw new CommandError(400, 'invalid tool');
  const held = context.permissions.request(body.sessionId, body.tool, requestText(body.tool, body.toolInput));
  if (!held) throw new CommandError(429, 'too many pending requests');
  // The hook went away (killed, timed out): free the request instead of leaving it pending.
  call.res.on('close', () => context.permissions.abandon(held.id));
  audit({ ip: call.ip, action: 'permission-request', id: held.id, session: body.sessionId, tool: body.tool });
  send(call.res, 200, { id: held.id, decision: await held.outcome });
}

/**
 * Permission hook of dashboard-started sessions: a loopback socket plus the hook secret, no login. It sits before the
 * login gate because Claude's hook process has no device session. The secret only lets a request be submitted: answers
 * come through `POST /api/permissions/:id` with the normal access rules, so no file a session can read answers a
 * request. (Loopback callers count as this PC, so a session can still reach that route over the network.) A bad
 * secret is a plain 403.
 */
export async function handlePermissionHook(context: ServerContext, call: RequestCall): Promise<boolean> {
  const { req, url, method } = call;
  if (url.pathname !== HOOK_PATH) return false;
  const isLoopbackSocket = LOOPBACK_ADDRESSES.includes(req.socket.remoteAddress ?? '');
  const hasSecret = context.permissions.checkSecret(req.headers['x-hook-secret']);
  if (!context.areCommandsEnabled || !isLoopbackSocket || !hasSecret) throw new CommandError(403, 'forbidden');
  if (method !== 'POST') throw new CommandError(405, 'method not allowed');
  await holdRequest(context, call);
  return true;
}
