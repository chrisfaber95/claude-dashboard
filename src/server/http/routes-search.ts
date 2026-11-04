import { CommandError } from '../claude/claude-cli.ts';
import type { RouteHandler } from './context.ts';
import { readJson } from './request-body.ts';
import { send } from './respond.ts';

/** Search: proxies query, ask and thumbs-down to the configured service; POST only, behind the same login and request checks. */
export const handleSearchRoutes: RouteHandler = async (context, call) => {
  const { url, method, req, res } = call;
  if (!url.pathname.startsWith('/api/search/')) return false;
  const { search } = context;
  if (method !== 'POST') return false;
  if (!search) throw new CommandError(503, 'Search is not configured.');
  if (url.pathname === '/api/search/query') {
    send(res, 200, await search.query(await readJson(req)));
    return true;
  }
  if (url.pathname === '/api/search/ask') {
    send(res, 200, await search.ask(await readJson(req)));
    return true;
  }
  if (url.pathname === '/api/search/feedback') {
    await search.feedback(await readJson(req));
    send(res, 200, { ok: true });
    return true;
  }
  return false;
};
