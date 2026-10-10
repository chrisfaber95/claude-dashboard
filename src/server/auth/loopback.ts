import type { IncomingMessage } from 'node:http';

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
/** Set by reverse proxies and tunnels. Never trusted; their presence only withdraws the loopback exemption. */
const PROXY_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'forwarded', 'via'];

/** Hostname from the Host header itself. */
function hostnameOf(host: string): string {
  if (host.startsWith('[')) return host.slice(0, host.indexOf(']') + 1);
  return host.split(':')[0].toLowerCase();
}

/**
 * Loopback exemption: the socket peer must be loopback AND the Host header a loopback host.
 * Forwarding headers (X-Forwarded-For and the like) are never trusted; if one is present the request is treated as
 * proxied and is not exempt, which also stops a same-PC proxy that adds them from opening the dashboard.
 */
export function isLoopbackRequest(request: IncomingMessage): boolean {
  if (PROXY_HEADERS.some((header) => request.headers[header] !== undefined)) return false;
  const address = request.socket?.remoteAddress;
  return !!address && LOOPBACK_ADDRESSES.has(address) && LOOPBACK_HOSTS.has(hostnameOf(request.headers.host ?? ''));
}
