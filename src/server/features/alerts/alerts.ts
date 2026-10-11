import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../../config.ts';
import { isRecord } from '../../../shared/guards.ts';
import type { Alert, AlertsInfo, LimitsInfo, SessionInfo, TeamBoard } from '../../../shared/types/index.ts';

/** Usage percentage at which a usage window raises an alert, until the user sets another. */
export const DEFAULT_THRESHOLD = 80;
/** At most this many source addresses are remembered; the one that failed longest ago is dropped first. */
export const MAX_SIGNIN_ADDRESSES = 50;
const SIGNIN_PREFIX = 'signin:';
const ADDRESS_MAX_CHARS = 64;
const IPV4_MAPPED_PREFIX = '::ffff:';
const THRESHOLD_MIN = 1;
const THRESHOLD_MAX = 100;

const FILE = () => join(DATA_DIR, 'alerts.json');

interface Persisted {
  dismissed: string[];
  threshold: number;
}

/** Failed LAN sign-ins per source address. In memory only; holds an address, a count and times, never an attempted token. */
export interface SigninFailure {
  address: string;
  count: number;
  lastMs: number;
}

/** What `deriveAlerts` and `buildAlerts` look at. */
export interface AlertInput {
  sessions: SessionInfo[];
  limits: LimitsInfo;
  team: TeamBoard | null;
  nowMs: number;
  /** Failed LAN sign-ins, one entry per source address. */
  signinFailures?: readonly SigninFailure[];
}

function isValidThreshold(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= THRESHOLD_MIN && value <= THRESHOLD_MAX;
}

let dismissed = new Set<string>();
let threshold = DEFAULT_THRESHOLD;
let isLoaded = false;
/** First state build that saw a condition, for alerts whose source has no time of its own. */
const firstSeen = new Map<string, number>();
const failures = new Map<string, SigninFailure>();

/** The socket address as people write it: no IPv4-mapped IPv6 prefix, bounded length. */
function normalizeAddress(address: string): string {
  const unmapped = address.startsWith(IPV4_MAPPED_PREFIX) && address.includes('.') ? address.slice(IPV4_MAPPED_PREFIX.length) : address;
  return unmapped.slice(0, ADDRESS_MAX_CHARS) || 'unknown';
}

/**
 * Count a failed or rate-limited sign-in against its source address (the socket address, never a forwarded header).
 * Matches the `onFailedLogin` hook of `createAuth`. Repeats update the one alert of that address.
 */
export function recordFailedSignin(address: string, atMs: number): void {
  const key = normalizeAddress(address);
  const previous = failures.get(key);
  failures.delete(key); // re-insert so Map order is last-failure order
  if (!previous && failures.size >= MAX_SIGNIN_ADDRESSES) {
    const oldest = failures.keys().next().value;
    if (oldest !== undefined) failures.delete(oldest);
  }
  failures.set(key, { address: key, count: (previous?.count ?? 0) + 1, lastMs: atMs });
}

function load(): void {
  if (isLoaded) return;
  isLoaded = true;
  try {
    const stored: unknown = JSON.parse(readFileSync(FILE(), 'utf8'));
    if (!isRecord(stored)) return;
    // signin alerts live in memory only; a stray signin id in the file is ignored
    if (Array.isArray(stored.dismissed)) {
      dismissed = new Set(stored.dismissed.filter((id): id is string => typeof id === 'string' && !id.startsWith(SIGNIN_PREFIX)));
    }
    if (isValidThreshold(stored.threshold)) threshold = stored.threshold;
  } catch {
    // missing or corrupt: defaults
  }
}

/** Write only when something changed (temp file + rename). Holds ids and a number only, nothing secret. */
function save(): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const tempPath = `${FILE()}.tmp`;
    const data: Persisted = { dismissed: [...dismissed].sort(), threshold };
    writeFileSync(tempPath, JSON.stringify(data));
    renameSync(tempPath, FILE());
  } catch {
    // keep the in-memory state; retry on the next change
  }
}

/** Dismiss an alert; a sign-in alert is cleared so a new failure opens a fresh one. */
export function dismissAlert(id: string): void {
  load();
  if (id.startsWith(SIGNIN_PREFIX)) {
    // Condition cleared: a new failure from that address opens a fresh alert.
    failures.delete(id.slice(SIGNIN_PREFIX.length));
    return;
  }
  if (dismissed.has(id)) return;
  dismissed.add(id);
  save();
}

/** Returns false for anything but an integer 1-100. */
export function setAlertThreshold(value: number): boolean {
  load();
  if (!isValidThreshold(value)) return false;
  if (value !== threshold) {
    threshold = value;
    save();
  }
  return true;
}

/** The current usage threshold in percent. */
export function alertThreshold(): number {
  load();
  return threshold;
}

/** Test hook: forget the in-memory state so the next call reloads the file. */
export function resetAlertStore(): void {
  dismissed = new Set();
  threshold = DEFAULT_THRESHOLD;
  isLoaded = false;
  firstSeen.clear();
  failures.clear();
}

const pad2 = (value: number) => String(value).padStart(2, '0');
const clock = (ms: number) => {
  const date = new Date(ms);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
};

function sessionAlerts(sessions: SessionInfo[], since: (id: string) => number): Alert[] {
  return sessions
    .filter((session) => session.status === 'waiting')
    .map((session): Alert => {
      const id = `session:${session.sessionId}`;
      return { id, kind: 'session', title: session.name, detail: 'Waiting for you', sinceMs: session.updatedAtMs || since(id), resetsAtMs: null };
    });
}

function usageAlerts(limits: LimitsInfo, thresholdPercent: number, since: (id: string) => number): Alert[] {
  return limits.windows
    .filter((window) => window.utilization >= thresholdPercent)
    .map((window): Alert => {
      const id = `usage:${window.key}`;
      return {
        id,
        kind: 'usage',
        title: window.label,
        detail: `${Math.round(window.utilization)}% used`,
        sinceMs: since(id),
        resetsAtMs: window.resetsAtMs,
      };
    });
}

function ticketAlerts(team: TeamBoard | null, since: (id: string) => number): Alert[] {
  return (team?.active.review ?? []).map((ticket): Alert => {
    const id = `ticket:${ticket.id}`;
    return { id, kind: 'ticket', title: ticket.id, detail: ticket.title, sinceMs: since(id), resetsAtMs: null };
  });
}

function signinAlerts(signinFailures: readonly SigninFailure[]): Alert[] {
  return signinFailures.map((failure): Alert => ({
    id: `${SIGNIN_PREFIX}${failure.address}`,
    kind: 'signin',
    title: 'Failed sign-in',
    detail: `${failure.address} · ${failure.count} failed ${failure.count === 1 ? 'attempt' : 'attempts'} · last at ${clock(failure.lastMs)}`,
    sinceMs: failure.lastMs,
    resetsAtMs: null,
  }));
}

/** Every condition that needs the user right now, one alert per deterministic id. Pure. */
export function deriveAlerts(
  input: AlertInput,
  thresholdPercent: number,
  since: (id: string) => number = () => input.nowMs,
): Alert[] {
  const byId = new Map<string, Alert>();
  const alerts = [
    ...sessionAlerts(input.sessions, since),
    ...usageAlerts(input.limits, thresholdPercent, since),
    ...ticketAlerts(input.team, since),
    ...signinAlerts(input.signinFailures ?? []),
  ];
  for (const alert of alerts) byId.set(alert.id, alert);
  return [...byId.values()];
}

/** First time a condition was seen, remembered across state builds. */
function firstSeenAt(id: string, nowMs: number): number {
  let seenAtMs = firstSeen.get(id);
  if (seenAtMs === undefined) {
    seenAtMs = nowMs;
    firstSeen.set(id, seenAtMs);
  }
  return seenAtMs;
}

/** Derive the alerts for a state build, hide dismissed ones and forget dismissals whose condition is gone. */
export function buildAlerts(input: AlertInput): AlertsInfo {
  load();
  const all = deriveAlerts({ ...input, signinFailures: [...failures.values()] }, threshold, (id) => firstSeenAt(id, input.nowMs));
  const activeIds = new Set(all.map((alert) => alert.id));
  for (const id of firstSeen.keys()) if (!activeIds.has(id)) firstSeen.delete(id);

  // Without limit data we can't tell whether a usage condition cleared, so keep those dismissals.
  const shouldKeepUsage = input.limits.source === 'none';
  let hasChanged = false;
  for (const id of [...dismissed]) {
    if (activeIds.has(id) || (shouldKeepUsage && id.startsWith('usage:'))) continue;
    dismissed.delete(id);
    hasChanged = true;
  }
  if (hasChanged) save();

  return { items: all.filter((alert) => !dismissed.has(alert.id)), threshold };
}
