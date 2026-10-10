import { CommandError } from '../claude/claude-cli.ts';
import { dismissAlert, setAlertThreshold } from '../features/alerts/alerts.ts';
import { getSummaryMode, setSummaryMode } from '../features/settings/settings.ts';
import type { RouteHandler } from './context.ts';
import { readJson } from './request-body.ts';
import { send } from './respond.ts';

const ALERT_ID_MAX = 200;

/** Alert dismissal, the alert threshold and the summary mode. */
export const handleSettingsRoutes: RouteHandler = async (context, call) => {
  const { url, method, req, res } = call;
  if (url.pathname === '/api/alerts/dismiss' && method === 'POST') {
    const body = await readJson(req);
    if (typeof body.id !== 'string' || body.id.length === 0 || body.id.length > ALERT_ID_MAX) {
      throw new CommandError(400, 'invalid alert id');
    }
    // Only an alert that is open right now can be dismissed, so the store can't be filled with arbitrary ids.
    if (!context.buildDashboardState().alerts.items.some((alert) => alert.id === body.id)) {
      throw new CommandError(404, 'unknown alert');
    }
    dismissAlert(body.id);
    send(res, 200, { ok: true });
    return true;
  }
  if (url.pathname === '/api/settings/alerts' && method === 'POST') {
    const body = await readJson(req);
    if (typeof body.threshold !== 'number' || !setAlertThreshold(body.threshold)) {
      throw new CommandError(400, 'threshold must be a whole number from 1 to 100');
    }
    send(res, 200, { ok: true });
    return true;
  }
  if (url.pathname === '/api/settings/summary' && method === 'GET') {
    send(res, 200, { summary: getSummaryMode() });
    return true;
  }
  if (url.pathname === '/api/settings/summary' && method === 'POST') {
    const body = await readJson(req);
    if (!setSummaryMode(body.summary)) throw new CommandError(400, "summary must be 'recap' or 'model'");
    send(res, 200, { summary: getSummaryMode() });
    return true;
  }
  return false;
};
