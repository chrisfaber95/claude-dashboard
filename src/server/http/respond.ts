import type { ServerResponse } from 'node:http';
import { SECURITY_HEADERS } from './guards.ts';

/** Answer with a JSON body, no caching and the security headers. */
export function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers });
  res.end(JSON.stringify(body));
}

/** Answer with a redirect, optionally setting a cookie. */
export function redirect(res: ServerResponse, location: string, headers: Record<string, string> = {}): void {
  res.writeHead(303, { Location: location, ...headers, ...SECURITY_HEADERS }).end();
}
