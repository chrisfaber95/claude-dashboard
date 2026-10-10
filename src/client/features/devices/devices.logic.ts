// Pure device-list logic (no DOM): testable with node --test.
import type { DeviceInfo } from '../../../shared/types/index.ts';

const pad = (n: number) => String(n).padStart(2, '0');

/** Local date as YYYY-MM-DD. */
export function createdLabel(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "never" before the first sign-in, then a coarse relative time. */
export function lastSeenLabel(ms: number | null, nowMs: number): string {
  if (ms === null) return 'never';
  const s = Math.max(0, (nowMs - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

/** Newest first, so a device that was just added is on top. */
export function sortDevices(list: readonly DeviceInfo[]): DeviceInfo[] {
  return [...list].sort((a, b) => b.createdMs - a.createdMs || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** The name as the server will accept it: trimmed, 1-40 characters. Returns null when it is not. */
export function cleanName(raw: string): string | null {
  const n = raw.trim();
  return n.length >= 1 && n.length <= 40 ? n : null;
}
