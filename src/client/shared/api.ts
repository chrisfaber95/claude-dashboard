export class ApiError extends Error {}

/** Same-origin API call. POSTs carry the CSRF header; a 401 sends the browser to the login page. */
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Dashboard': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (res.status === 401) {
    location.href = '/login';
    throw new ApiError('login required');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `request failed (${res.status})`);
  return data as T;
}
