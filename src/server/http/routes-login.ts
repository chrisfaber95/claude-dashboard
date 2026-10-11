import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Auth } from '../auth/auth.ts';
import type { AuthedCall, RequestCall, ServerContext } from './context.ts';
import { SECURITY_HEADERS } from './guards.ts';
import { readBody } from './request-body.ts';
import { redirect, send } from './respond.ts';
import { HTML_CONTENT_TYPE, serveStatic } from './static-files.ts';

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

async function submitLogin(context: ServerContext, auth: Auth, call: RequestCall): Promise<void> {
  const token = new URLSearchParams(await readBody(call.req)).get('token') ?? '';
  const result = auth.login(call.ip, token);
  if (result === 'rate-limited') {
    redirect(call.res, '/login?e=rate');
  } else if (result) {
    redirect(call.res, '/', { 'Set-Cookie': auth.cookie(result, context.isTlsEnabled) });
  } else {
    redirect(call.res, '/login?e=1');
  }
}

/**
 * QR pairing, in two steps so a camera app or link preview that fetches the URL first cannot spend the code. GET only
 * shows "Sign in as <device>?" and changes nothing.
 */
async function showPairPage(context: ServerContext, auth: Auth, call: RequestCall): Promise<void> {
  const name = auth.peekPairing(call.url.searchParams.get('c') ?? '');
  try {
    const page = (await readFile(join(context.publicDir, 'pair.html'), 'utf8'))
      .replace('__STATE__', name === null ? 'bad' : 'ok')
      .replace('__DEVICE__', () => escapeHtml(name ?? ''));
    call.res.writeHead(200, { 'Content-Type': HTML_CONTENT_TYPE, 'Cache-Control': 'no-store', ...SECURITY_HEADERS }).end(page);
  } catch {
    call.res.writeHead(404, SECURITY_HEADERS).end('Not found');
  }
}

/**
 * The button POSTs the code: a good one is spent and sets the session cookie (the page then navigates to / itself, so
 * the Strict cookie is sent); anything else is a failed sign-in (rate limit + alert).
 */
async function submitPairing(context: ServerContext, auth: Auth, call: RequestCall): Promise<void> {
  const result = auth.pair(call.ip, new URLSearchParams(await readBody(call.req)).get('c') ?? '');
  if (result === 'rate-limited') send(call.res, 429, { error: 'too many attempts' });
  else if (result === null) send(call.res, 401, { error: 'invalid or used code' });
  else send(call.res, 200, { ok: true }, { 'Set-Cookie': auth.cookie(result, context.isTlsEnabled) });
}

/** The login page and its form post, and the two QR pairing steps. Only exists with a login (LAN mode). */
export async function handleLoginRoutes(context: ServerContext, call: RequestCall): Promise<boolean> {
  const { auth } = context;
  if (!auth) return false;
  const { url, method } = call;
  if (url.pathname === '/login') {
    if (method === 'POST') await submitLogin(context, auth, call);
    else await serveStatic(context.publicDir, call.res, '/login.html', call.req.headers['accept-encoding']);
    return true;
  }
  if (url.pathname === '/pair' && method === 'GET') {
    await showPairPage(context, auth, call);
    return true;
  }
  if (url.pathname === '/pair' && method === 'POST') {
    await submitPairing(context, auth, call);
    return true;
  }
  return false;
}

/** Sign out the calling device's session and go back to the login page. */
export function handleLogout(context: ServerContext, call: AuthedCall): Promise<boolean> {
  const { auth } = context;
  if (!auth || call.url.pathname !== '/logout' || call.method !== 'POST') return Promise.resolve(false);
  auth.logout(call.req);
  redirect(call.res, '/login', { 'Set-Cookie': auth.clearCookie(context.isTlsEnabled) });
  return Promise.resolve(true);
}
