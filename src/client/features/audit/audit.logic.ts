// Pure audit-view logic (no DOM): testable with node --test.
import type { AuditEntry } from '../../../shared/types/index.ts';

/** The "All devices" choice has this value; every other option's value is a device id. */
export const ALL_DEVICES = '';

/** One choice of the device filter dropdown. */
export interface DeviceOption {
  id: string;
  name: string;
}

const SESSION_PREFIX_LENGTH = 8;

const pad = (value: number) => String(value).padStart(2, '0');

/** The ids the server accepts as a filter; anything else can't be filtered on, so it is not offered. */
const FILTERABLE = /^[A-Za-z0-9_-]{1,64}$/;

/** Local `YYYY-MM-DD HH:MM:SS`, or the raw text when the timestamp does not parse. */
export function timeLabel(ts: string): string {
  const ms = Date.parse(ts);
  if (Number.isNaN(ms)) return ts;
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
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

/** One audit entry prepared for display. */
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

function resultOf(isOk: boolean | undefined): AuditRow['result'] {
  if (isOk === true) return 'ok';
  if (isOk === false) return 'failed';
  return '';
}

/** Turn an audit entry into display strings. */
export function rowOf(entry: AuditEntry): AuditRow {
  return {
    time: timeLabel(entry.ts),
    device: entry.device ?? entry.deviceId ?? 'unknown',
    action: actionLabel(entry.action),
    target: entry.project ?? (entry.session ? entry.session.slice(0, SESSION_PREFIX_LENGTH) : ''),
    result: resultOf(entry.ok),
    prompt: entry.prompt ?? '',
  };
}

/**
 * Filter choices: "All devices" first, then every device seen so far by name. `known` carries the choices of earlier
 * loads, so the list does not shrink to one device once the view is filtered. A device renamed or revoked keeps its
 * latest name. Entries without a device id add nothing.
 */
export function mergeDeviceOptions(known: readonly DeviceOption[], entries: readonly AuditEntry[]): DeviceOption[] {
  const byId = new Map(known.map((option) => [option.id, option.name] as const));
  // entries are newest first: the first name seen for an id is its latest
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry.deviceId || !FILTERABLE.test(entry.deviceId) || seen.has(entry.deviceId)) continue;
    seen.add(entry.deviceId);
    byId.set(entry.deviceId, entry.device ?? entry.deviceId);
  }
  return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** The query string for the selected filter. Only an id that is a plain token is sent. */
export function auditQuery(deviceId: string): string {
  return FILTERABLE.test(deviceId) ? `?device=${encodeURIComponent(deviceId)}` : '';
}
