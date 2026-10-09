// Pure audit-view logic (no DOM): testable with node --test.
import type { AuditEntry } from '../shared/types.ts';

/** The "All devices" choice has this value; every other option's value is a device id. */
export const ALL_DEVICES = '';

export interface DeviceOption {
  id: string;
  name: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The ids the server accepts as a filter; anything else can't be filtered on, so it is not offered. */
const FILTERABLE = /^[A-Za-z0-9_-]{1,64}$/;

/** Local `YYYY-MM-DD HH:MM:SS`, or the raw text when the timestamp does not parse. */
export function timeLabel(ts: string): string {
  const ms = Date.parse(ts);
  if (Number.isNaN(ms)) return ts;
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const ACTIONS: Record<string, string> = {
  start: 'Started a task',
  message: 'Sent a message',
  stop: 'Stopped a session',
  'device-create': 'Added a device',
  'device-revoke': 'Revoked a device',
  'device-pair': 'Showed a QR code',
};

/** A readable action; an unknown one is shown as it is. */
export const actionLabel = (action: string): string => ACTIONS[action] ?? action;

export interface AuditRow {
  time: string;
  device: string;
  action: string;
  /** Project, else the first 8 characters of the session id, else empty. */
  target: string;
  /** `ok`, `failed`, or empty when the entry has no result. */
  result: 'ok' | 'failed' | '';
  prompt: string;
}

export function rowOf(e: AuditEntry): AuditRow {
  return {
    time: timeLabel(e.ts),
    device: e.device ?? e.deviceId ?? 'unknown',
    action: actionLabel(e.action),
    target: e.project ?? (e.session ? e.session.slice(0, 8) : ''),
    result: e.ok === true ? 'ok' : e.ok === false ? 'failed' : '',
    prompt: e.prompt ?? '',
  };
}

/**
 * Filter choices: "All devices" first, then every device seen so far by name. `known` carries the choices of earlier
 * loads, so the list does not shrink to one device once the view is filtered. A device renamed or revoked keeps its
 * latest name. Entries without a device id add nothing.
 */
export function mergeDeviceOptions(known: readonly DeviceOption[], entries: readonly AuditEntry[]): DeviceOption[] {
  const byId = new Map(known.map((o) => [o.id, o.name] as const));
  // entries are newest first: the first name seen for an id is its latest
  const seen = new Set<string>();
  for (const e of entries) {
    if (!e.deviceId || !FILTERABLE.test(e.deviceId) || seen.has(e.deviceId)) continue;
    seen.add(e.deviceId);
    byId.set(e.deviceId, e.device ?? e.deviceId);
  }
  return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** The query string for the selected filter. Only an id that is a plain token is sent. */
export function auditQuery(deviceId: string): string {
  return FILTERABLE.test(deviceId) ? `?device=${encodeURIComponent(deviceId)}` : '';
}
