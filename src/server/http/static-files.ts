import type { ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { AuthedCall, ServerContext } from './context.ts';
import { SECURITY_HEADERS, resolveStaticPath } from './guards.ts';
import { send } from './respond.ts';

/** Content type of HTML pages. */
export const HTML_CONTENT_TYPE = 'text/html; charset=utf-8';
const CONTENT_TYPES: Record<string, string> = {
  '.html': HTML_CONTENT_TYPE,
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};
const READ_METHODS = new Set(['GET', 'HEAD']);

/** Serve one file below the public folder: 403 outside it, 404 when missing. */
export async function serveStatic(publicDir: string, res: ServerResponse, relativePath: string): Promise<void> {
  const file = resolveStaticPath(publicDir, relativePath);
  if (file === null) {
    res.writeHead(403, SECURITY_HEADERS).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream', ...SECURITY_HEADERS });
    res.end(body);
  } catch {
    res.writeHead(404, SECURITY_HEADERS).end('Not found');
  }
}

/** Last route: unknown API paths are 404, non-GET is 405, everything else is a static file. */
export async function handleStaticRoute(context: ServerContext, call: AuthedCall): Promise<void> {
  const { res, url, method } = call;
  if (url.pathname.startsWith('/api/')) {
    send(res, 404, { error: 'not found' });
    return;
  }
  if (!READ_METHODS.has(method)) {
    send(res, 405, { error: 'method not allowed' });
    return;
  }
  let relativePath: string;
  try {
    relativePath = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400, SECURITY_HEADERS).end();
    return;
  }
  await serveStatic(context.publicDir, res, relativePath);
}
