import type { ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
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
const COMPRESSIBLE_EXTENSIONS = new Set(['.html', '.js', '.css', '.svg']);
/** Vite output: `/assets/<name>-<8 character content hash>.<extension>`; the hash changes with every edit. */
const HASHED_ASSET_PATH = /^\/assets\/[^/\\]+-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/;
const IMMUTABLE_CACHE_CONTROL = 'private, max-age=31536000, immutable';
const REFUSED_QUALITY = /^q=0(\.0{0,3})?$/;
/** Bounds the in-memory gzip cache (path case variants and rebuilt hashed names would otherwise grow it). */
const MAX_COMPRESSED_FILES = 64;
const compressGzip = promisify(gzip);

/** A compressed copy of one file, valid while the file keeps its modification time and size. */
interface CompressedFile {
  modifiedMs: number;
  sizeBytes: number;
  body: Buffer;
}
const compressedFiles = new Map<string, CompressedFile>();

/** True when an Accept-Encoding header lists gzip and does not refuse it with q=0. */
export function acceptsGzip(acceptEncoding: string | undefined): boolean {
  if (!acceptEncoding) return false;
  return acceptEncoding.split(',').some((part) => {
    const [name, ...parameters] = part.toLowerCase().split(';').map((piece) => piece.trim());
    return name === 'gzip' && !parameters.some((parameter) => REFUSED_QUALITY.test(parameter));
  });
}

/** Cache-Control for a served path: hashed build assets are immutable, everything else gets none. */
export function cacheControlFor(relativePath: string): string | undefined {
  return HASHED_ASSET_PATH.test(relativePath) ? IMMUTABLE_CACHE_CONTROL : undefined;
}

/** Gzip of a file, compressed once and reused until the file changes (a rebuild). */
async function readGzipped(file: string): Promise<Buffer> {
  const { mtimeMs, size } = await stat(file);
  const cached = compressedFiles.get(file);
  if (cached && cached.modifiedMs === mtimeMs && cached.sizeBytes === size) return cached.body;
  const body = await compressGzip(await readFile(file));
  if (compressedFiles.size >= MAX_COMPRESSED_FILES) {
    const oldestFile = compressedFiles.keys().next().value;
    if (oldestFile !== undefined) compressedFiles.delete(oldestFile);
  }
  compressedFiles.set(file, { modifiedMs: mtimeMs, sizeBytes: size, body });
  return body;
}

/** Serve one file below the public folder: 403 outside it, 404 when missing; gzip when the client accepts it. */
export async function serveStatic(
  publicDir: string,
  res: ServerResponse,
  relativePath: string,
  acceptEncoding?: string,
): Promise<void> {
  const file = resolveStaticPath(publicDir, relativePath);
  if (file === null) {
    res.writeHead(403, SECURITY_HEADERS).end();
    return;
  }
  try {
    const extension = extname(file);
    const isCompressible = COMPRESSIBLE_EXTENSIONS.has(extension);
    const isGzipped = isCompressible && acceptsGzip(acceptEncoding);
    const body = isGzipped ? await readGzipped(file) : await readFile(file);
    const headers: Record<string, string> = {
      'Content-Type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
      ...SECURITY_HEADERS,
    };
    if (isCompressible) headers['Vary'] = 'Accept-Encoding';
    if (isGzipped) headers['Content-Encoding'] = 'gzip';
    const cacheControl = cacheControlFor(relativePath);
    if (cacheControl) headers['Cache-Control'] = cacheControl;
    res.writeHead(200, headers);
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
  await serveStatic(context.publicDir, res, relativePath, call.req.headers['accept-encoding']);
}
