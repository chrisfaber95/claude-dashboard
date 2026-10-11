const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;

/** Hours within the day and minutes within the hour of a span in seconds, plus whole days. */
function splitSpan(seconds: number): { days: number; hours: number; minutes: number } {
  return {
    days: Math.floor(seconds / SECONDS_PER_DAY),
    hours: Math.floor((seconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR),
    minutes: Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE),
  };
}

/** "3m ago" style text for a past timestamp; a dash when there is none. */
export function ago(timestampMs: number | null): string {
  if (!timestampMs) return '—';
  const seconds = Math.max(0, (Date.now() - timestampMs) / MS_PER_SECOND);
  if (seconds < SECONDS_PER_MINUTE) return 'just now';
  if (seconds < SECONDS_PER_HOUR) return `${Math.floor(seconds / SECONDS_PER_MINUTE)}m ago`;
  if (seconds < SECONDS_PER_DAY) return `${Math.floor(seconds / SECONDS_PER_HOUR)}h ago`;
  return `${Math.floor(seconds / SECONDS_PER_DAY)}d ago`;
}

/** "resets in 2h 5m" style text for a future timestamp. */
export function until(timestampMs: number | null): string {
  if (!timestampMs) return 'no reset scheduled';
  const seconds = (timestampMs - Date.now()) / MS_PER_SECOND;
  if (seconds <= 0) return 'resetting now';
  const { days, hours, minutes } = splitSpan(seconds);
  return `resets in ${days ? `${days}d ` : ''}${hours || days ? `${hours}h ` : ''}${minutes}m`;
}

/** "1h 5m" style text for the time since a start timestamp. */
export function uptime(startedAtMs: number | null): string {
  const seconds = (Date.now() - (startedAtMs ?? Date.now())) / MS_PER_SECOND;
  const hours = Math.floor(seconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** Which relative text a `RelativeTime` shows: time since, time until or uptime. */
export type TimeKind = 'ago' | 'until' | 'up';

const TIME_FORMAT: Record<TimeKind, (timestampMs: number | null) => string> = { ago, until, up: uptime };

/** Whether a value read from a `data-time` attribute is one of the relative time kinds. */
export function isTimeKind(value: unknown): value is TimeKind {
  return value === 'ago' || value === 'until' || value === 'up';
}

/** The text of one relative time, as `RelativeTime` shows it. */
export function formatRelativeTime(kind: TimeKind, timestampMs: number | null): string {
  return TIME_FORMAT[kind](timestampMs);
}

/** Rewrite the text of every `RelativeTime` (`[data-time]`), only where it changed. */
export function tickTimes(root: ParentNode = document): void {
  for (const element of root.querySelectorAll<HTMLElement>('[data-time]')) {
    const kind = element.dataset['time'];
    if (!isTimeKind(kind)) continue;
    const raw = element.dataset['ms'] ?? '';
    const text = formatRelativeTime(kind, raw === '' ? null : Number(raw));
    if (element.textContent !== text) element.textContent = text;
  }
}
