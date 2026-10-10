// Pure device-list logic (no DOM): testable with node --test.
import type { DeviceInfo } from '../../../shared/types/index.ts';

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86_400;
const MAX_NAME_LENGTH = 40;

const pad = (value: number) => String(value).padStart(2, '0');

/** Local date as YYYY-MM-DD. */
export function createdLabel(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "never" before the first sign-in, then a coarse relative time. */
export function lastSeenLabel(ms: number | null, nowMs: number): string {
  if (ms === null) return 'never';
  const seconds = Math.max(0, (nowMs - ms) / 1000);
  if (seconds < SECONDS_PER_MINUTE) return 'just now';
  if (seconds < SECONDS_PER_HOUR) return `${Math.floor(seconds / SECONDS_PER_MINUTE)}m ago`;
  if (seconds < SECONDS_PER_DAY) return `${Math.floor(seconds / SECONDS_PER_HOUR)}h ago`;
  return `${Math.floor(seconds / SECONDS_PER_DAY)}d ago`;
}

/** Newest first, so a device that was just added is on top. */
export function sortDevices(list: readonly DeviceInfo[]): DeviceInfo[] {
  return [...list].sort((a, b) => b.createdMs - a.createdMs || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** The name as the server will accept it: trimmed, 1-40 characters. Returns null when it is not. */
export function cleanName(raw: string): string | null {
  const name = raw.trim();
  return name.length >= 1 && name.length <= MAX_NAME_LENGTH ? name : null;
}
