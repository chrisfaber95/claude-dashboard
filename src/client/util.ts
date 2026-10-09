export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function ago(ms: number | null): string {
  if (!ms) return '—';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function until(ms: number | null): string {
  if (!ms) return 'no reset scheduled';
  const s = (ms - Date.now()) / 1000;
  if (s <= 0) return 'resetting now';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `resets in ${d ? `${d}d ` : ''}${h || d ? `${h}h ` : ''}${m}m`;
}

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

export function uptime(ms: number | null): string {
  const s = (Date.now() - (ms ?? Date.now())) / 1000;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

export type TimeKind = 'ago' | 'until' | 'up';

const TIME_FORMAT: Record<TimeKind, (ms: number | null) => string> = { ago, until, up: uptime };

/** A relative time whose text `tickTimes()` keeps current between pushes. */
export function timeSpan(kind: TimeKind, ms: number | null): string {
  return `<span data-time="${kind}" data-ms="${ms ?? ''}">${esc(TIME_FORMAT[kind](ms))}</span>`;
}

/** Rewrite the text of every `timeSpan`, only where it changed. */
export function tickTimes(root: ParentNode = document): void {
  for (const e of root.querySelectorAll<HTMLElement>('[data-time]')) {
    const kind = e.dataset['time'] as TimeKind;
    const raw = e.dataset['ms'] ?? '';
    const text = TIME_FORMAT[kind]?.(raw === '' ? null : Number(raw));
    if (text !== undefined && e.textContent !== text) e.textContent = text;
  }
}
