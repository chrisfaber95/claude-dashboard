import { CommandError } from '../claude/claude-cli.ts';
import { PC_DEVICE } from '../auth/auth.ts';
import { APPROVALS_MAX, LAUNCHES_MAX, readAudit } from '../features/audit-log/audit-log.ts';
import type { AuthedCall, RouteHandler, ServerContext } from './context.ts';
import { SECURITY_HEADERS } from './guards.ts';
import { withManageDevices } from './live-streams.ts';
import { send } from './respond.ts';

const DEVICE_FILTER_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** The command log, newest first, allowlisted fields only. Any signed-in device (or this PC) may read it. */
async function sendAudit(call: AuthedCall): Promise<void> {
  const device = call.url.searchParams.get('device');
  if (device !== null && !DEVICE_FILTER_RE.test(device)) throw new CommandError(400, 'invalid device filter');
  try {
    send(call.res, 200, { entries: await readAudit(device ?? undefined) });
  } catch {
    throw new CommandError(500, 'could not read the audit log');
  }
}

/** The latest launches, newest first, from the same log and with the same access as /api/audit. */
async function sendLaunches(call: AuthedCall): Promise<void> {
  try {
    send(call.res, 200, { launches: await readAudit(undefined, { action: 'start', limit: LAUNCHES_MAX }) });
  } catch {
    throw new CommandError(500, 'could not read the launch history');
  }
}

/** The latest approvals (allow, deny, expired), newest first, with the same access as /api/audit. */
async function sendApprovals(call: AuthedCall): Promise<void> {
  try {
    send(call.res, 200, { approvals: await readAudit(undefined, { action: 'approval', limit: APPROVALS_MAX }) });
  } catch {
    throw new CommandError(500, 'could not read the approval log');
  }
}

function openEventStream(context: ServerContext, call: AuthedCall): void {
  const { req, res, who } = call;
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', ...SECURITY_HEADERS });
  res.write(`data: ${JSON.stringify(withManageDevices(context.buildDashboardState(), who?.deviceId === PC_DEVICE))}\n\n`);
  context.streams.add(res, { deviceId: who?.deviceId ?? '', sessionId: who?.sid ?? null });
  req.on('close', () => context.streams.remove(res));
}

/** The dashboard state, the audit log, the launch and approval history and the live event stream. */
export const handleStateRoutes: RouteHandler = async (context, call) => {
  const { url, method, res, who } = call;
  if (url.pathname === '/api/state') {
    send(res, 200, withManageDevices(context.buildDashboardState(), who?.deviceId === PC_DEVICE));
    return true;
  }
  if (url.pathname === '/api/audit' && method === 'GET') {
    await sendAudit(call);
    return true;
  }
  if (url.pathname === '/api/launches' && method === 'GET') {
    await sendLaunches(call);
    return true;
  }
  if (url.pathname === '/api/approvals' && method === 'GET') {
    await sendApprovals(call);
    return true;
  }
  if (url.pathname === '/api/events') {
    openEventStream(context, call);
    return true;
  }
  return false;
};
