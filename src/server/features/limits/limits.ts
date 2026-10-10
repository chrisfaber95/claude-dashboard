import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLAUDE_DIR, CLAUDE_JSON } from '../../config.ts';
import { limitHits } from '../../transcripts/transcripts.ts';
import type { LimitWindow, LimitsInfo } from '../../../shared/types/index.ts';

const LIVE_ENABLED = process.env.DASHBOARD_LIVE_USAGE !== '0';
const POLL_MS = 60_000;
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

const LABELS: Record<string, string> = {
  five_hour: '5-hour',
  seven_day: '7-day',
  seven_day_opus: '7-day Opus',
  seven_day_sonnet: '7-day Sonnet',
};

interface Snapshot {
  source: 'live' | 'cache';
  fetchedAtMs: number;
  windows: LimitWindow[];
}

let live: Snapshot | null = null;
let liveError: string | null = null;
let lastPoll = 0;
let polling = false;

export function toWindows(utilization: Record<string, any> | undefined | null): LimitWindow[] {
  if (!utilization) return [];
  const out: LimitWindow[] = [];
  for (const [key, label] of Object.entries(LABELS)) {
    const w = utilization[key];
    if (!w || typeof w.utilization !== 'number') continue;
    out.push({
      key,
      label,
      utilization: w.utilization,
      resetsAtMs: w.resets_at ? Date.parse(w.resets_at) : null,
    });
  }
  return out;
}

function readCache(): Snapshot | null {
  try {
    const j = JSON.parse(readFileSync(CLAUDE_JSON, 'utf8'));
    const c = j.cachedUsageUtilization;
    if (!c) return null;
    return { source: 'cache', fetchedAtMs: c.fetchedAtMs ?? 0, windows: toWindows(c.utilization) };
  } catch {
    return null; // file may be mid-write; try again next tick
  }
}

/**
 * Opt-in live poll. The OAuth access token is read server-side, held only for the
 * duration of the request, and never logged or exposed through the API. It is never refreshed here.
 */
export async function pollLive() {
  if (polling) return;
  polling = true;
  try {
    let token: unknown;
    try {
      token = JSON.parse(readFileSync(join(CLAUDE_DIR, '.credentials.json'), 'utf8'))?.claudeAiOauth?.accessToken;
    } catch {
      // Never surface the raw error: JSON.parse messages can quote part of the file (i.e. the token).
      throw new Error('credentials unreadable');
    }
    if (typeof token !== 'string') throw new Error('no OAuth access token available');
    const res = await fetch(USAGE_URL, {
      redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`usage API responded ${res.status}`);
    const body: any = await res.json().catch(() => null);
    const windows = toWindows(body);
    if (!windows.length) throw new Error('unexpected usage API response shape');
    live = { source: 'live', fetchedAtMs: Date.now(), windows };
    liveError = null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    // Only fixed, known messages reach the browser.
    liveError = /^(usage API responded \d+|unexpected usage API response shape|credentials unreadable|no OAuth access token available)$/.test(msg)
      ? msg
      : 'usage API unreachable';
  } finally {
    polling = false;
  }
}

export function getLimits(): LimitsInfo {
  if (LIVE_ENABLED && Date.now() - lastPoll > POLL_MS) {
    lastPoll = Date.now();
    void pollLive();
  }
  const cache = readCache();
  const snap = live && (!cache || live.fetchedAtMs >= cache.fetchedAtMs) ? live : cache;
  return {
    source: snap?.source ?? 'none',
    fetchedAtMs: snap?.fetchedAtMs ?? null,
    error: LIVE_ENABLED ? liveError : 'live polling off (DASHBOARD_LIVE_USAGE=0)',
    windows: snap?.windows ?? [],
    hits: limitHits.slice(-20),
  };
}
