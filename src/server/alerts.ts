import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './config.ts';
import type { Alert, AlertsInfo, LimitsInfo, SessionInfo, TeamBoard } from '../shared/types.ts';

export const DEFAULT_THRESHOLD = 80;
/** At most this many source addresses are remembered; the one that failed longest ago is dropped first. */
export const MAX_SIGNIN_ADDRESSES = 50;
const SIGNIN_PREFIX = 'signin:';
const ADDRESS_MAX = 64;

const FILE = () => join(DATA_DIR, 'alerts.json');

interface Persisted {
  dismissed: string[];
  threshold: number;
}

function validThreshold(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 100;
}

let dismissed = new Set<string>();
let threshold = DEFAULT_THRESHOLD;
let loaded = false;
/** First state build that saw a condition, for alerts whose source has no time of its own. */
const firstSeen = new Map<string, number>();

/** Failed LAN sign-ins per source address. In memory only; holds an address, a count and times, never an attempted token. */
export interface SigninFailure {
  address: string;
  count: number;
  lastMs: number;
}
const failures = new Map<string, SigninFailure>();

/** The socket address as people write it: no IPv4-mapped IPv6 prefix, bounded length. */
function normalizeAddress(a: string): string {
  return (a.startsWith('::ffff:') && a.includes('.') ? a.slice(7) : a).slice(0, ADDRESS_MAX) || 'unknown';
}

/**
 * Count a failed or rate-limited sign-in against its source address (the socket address, never a forwarded header).
 * Matches the `onFailedLogin` hook of `createAuth`. Repeats update the one alert of that address.
 */
export function recordFailedSignin(address: string, tMs: number): void {
  const key = normalizeAddress(address);
  const prev = failures.get(key);
  failures.delete(key); // re-insert so Map order is last-failure order
  if (!prev && failures.size >= MAX_SIGNIN_ADDRESSES) {
    const oldest = failures.keys().next().value;
    if (oldest !== undefined) failures.delete(oldest);
  }
  failures.set(key, { address: key, count: (prev?.count ?? 0) + 1, lastMs: tMs });
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const j = JSON.parse(readFileSync(FILE(), 'utf8')) as Partial<Persisted>;
    // signin alerts live in memory only; a stray signin id in the file is ignored
    if (Array.isArray(j.dismissed)) dismissed = new Set(j.dismissed.filter((x): x is string => typeof x === 'string' && !x.startsWith(SIGNIN_PREFIX)));
    if (validThreshold(j.threshold)) threshold = j.threshold;
  } catch {
    // missing or corrupt: defaults
  }
}

/** Write only when something changed (tmp + rename). Holds ids and a number only, nothing secret. */
function save(): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${FILE()}.tmp`;
    const data: Persisted = { dismissed: [...dismissed].sort(), threshold };
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, FILE());
  } catch {
    // keep the in-memory state; retry on the next change
  }
}

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
export function setAlertThreshold(n: number): boolean {
  load();
  if (!validThreshold(n)) return false;
  if (n !== threshold) {
    threshold = n;
    save();
  }
  return true;
}

export function alertThreshold(): number {
  load();
  return threshold;
}

/** Test hook: forget the in-memory state so the next call reloads the file. */
export function resetAlertStore(): void {
  dismissed = new Set();
  threshold = DEFAULT_THRESHOLD;
  loaded = false;
  firstSeen.clear();
  failures.clear();
}

export interface AlertInput {
  sessions: SessionInfo[];
  limits: LimitsInfo;
  team: TeamBoard | null;
  nowMs: number;
  /** Failed LAN sign-ins, one entry per source address. */
  signinFailures?: readonly SigninFailure[];
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const clock = (ms: number) => {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
};

/** Every condition that needs the user right now, one alert per deterministic id. Pure. */
export function deriveAlerts(
  input: AlertInput,
  thresholdPct: number,
  since: (id: string) => number = () => input.nowMs,
): Alert[] {
  const out = new Map<string, Alert>();
  for (const s of input.sessions) {
    if (s.status !== 'waiting') continue;
    const id = `session:${s.sessionId}`;
    out.set(id, { id, kind: 'session', title: s.name, detail: 'Waiting for you', sinceMs: s.updatedAtMs || since(id), resetsAtMs: null });
  }
  for (const w of input.limits.windows) {
    if (!(w.utilization >= thresholdPct)) continue;
    const id = `usage:${w.key}`;
    out.set(id, {
      id,
      kind: 'usage',
      title: w.label,
      detail: `${Math.round(w.utilization)}% used`,
      sinceMs: since(id),
      resetsAtMs: w.resetsAtMs,
    });
  }
  for (const t of input.team?.active.review ?? []) {
    const id = `ticket:${t.id}`;
    out.set(id, { id, kind: 'ticket', title: t.id, detail: t.title, sinceMs: since(id), resetsAtMs: null });
  }
  for (const f of input.signinFailures ?? []) {
    const id = `${SIGNIN_PREFIX}${f.address}`;
    out.set(id, {
      id,
      kind: 'signin',
      title: 'Failed sign-in',
      detail: `${f.address} · ${f.count} failed ${f.count === 1 ? 'attempt' : 'attempts'} · last at ${clock(f.lastMs)}`,
      sinceMs: f.lastMs,
      resetsAtMs: null,
    });
  }
  return [...out.values()];
}

/** Derive the alerts for a state build, hide dismissed ones and forget dismissals whose condition is gone. */
export function buildAlerts(input: AlertInput): AlertsInfo {
  load();
  const all = deriveAlerts({ ...input, signinFailures: [...failures.values()] }, threshold, (id) => {
    let t = firstSeen.get(id);
    if (t === undefined) {
      t = input.nowMs;
      firstSeen.set(id, t);
    }
    return t;
  });
  const active = new Set(all.map((a) => a.id));
  for (const id of firstSeen.keys()) if (!active.has(id)) firstSeen.delete(id);

  // Without limit data we can't tell whether a usage condition cleared, so keep those dismissals.
  const keepUsage = input.limits.source === 'none';
  let changed = false;
  for (const id of [...dismissed]) {
    if (active.has(id) || (keepUsage && id.startsWith('usage:'))) continue;
    dismissed.delete(id);
    changed = true;
  }
  if (changed) save();

  return { items: all.filter((a) => !dismissed.has(a.id)), threshold };
}
