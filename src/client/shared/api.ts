import { isRecord } from '../../shared/guards.ts';

/** An API call that failed; its message is safe to show to the user. */
export class ApiError extends Error {}

/** Same-origin API call. POSTs carry the CSRF header; a 401 sends the browser to the login page. */
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Dashboard': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (response.status === 401) {
    location.href = '/login';
    throw new ApiError('login required');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(isRecord(data) && typeof data.error === 'string' ? data.error : `request failed (${response.status})`);
  }
  return data; // the caller names the shape it expects from its own endpoint
}
