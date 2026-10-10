import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLAUDE_DIR, CLAUDE_JSON } from '../../config.ts';
import { limitHits } from '../../transcripts/transcripts.ts';
import type { LimitWindow, LimitsInfo } from '../../../shared/types/index.ts';

const isLiveEnabled = process.env.DASHBOARD_LIVE_USAGE !== '0';
const POLL_INTERVAL_MS = 60_000;
const POLL_TIMEOUT_MS = 10_000;
const HITS_MAX = 20;
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

const LABELS: Record<string, string> = {
  five_hour: '5-hour',
  seven_day: '7-day',
  seven_day_opus: '7-day Opus',
  seven_day_sonnet: '7-day Sonnet',
};

/** The only error texts that may reach the browser. */
const KNOWN_ERROR_PATTERN = /^(usage API responded \d+|unexpected usage API response shape|credentials unreadable|no OAuth access token available)$/;

interface Snapshot {
  source: 'live' | 'cache';
  fetchedAtMs: number;
  windows: LimitWindow[];
}

let live: Snapshot | null = null;
let liveError: string | null = null;
let lastPollMs = 0;
let isPolling = false;

/** Pick the known usage windows out of a usage API (or cached) utilization object. */
export function toWindows(utilization: Record<string, any> | undefined | null): LimitWindow[] {
  if (!utilization) return [];
  const out: LimitWindow[] = [];
  for (const [key, label] of Object.entries(LABELS)) {
    const usageWindow = utilization[key];
    if (!usageWindow || typeof usageWindow.utilization !== 'number') continue;
    out.push({
      key,
      label,
      utilization: usageWindow.utilization,
      resetsAtMs: usageWindow.resets_at ? Date.parse(usageWindow.resets_at) : null,
    });
  }
  return out;
}

function readCache(): Snapshot | null {
  try {
    const claudeJson = JSON.parse(readFileSync(CLAUDE_JSON, 'utf8'));
    const cached = claudeJson.cachedUsageUtilization;
    if (!cached) return null;
    return { source: 'cache', fetchedAtMs: cached.fetchedAtMs ?? 0, windows: toWindows(cached.utilization) };
  } catch {
    return null; // file may be mid-write; try again next tick
  }
}

/**
 * Opt-in live poll. The OAuth access token is read server-side, held only for the
 * duration of the request, and never logged or exposed through the API. It is never refreshed here.
 */
export async function pollLive(): Promise<void> {
  if (isPolling) return;
  isPolling = true;
  try {
    let token: unknown;
    try {
      token = JSON.parse(readFileSync(join(CLAUDE_DIR, '.credentials.json'), 'utf8'))?.claudeAiOauth?.accessToken;
    } catch {
      // Never surface the raw error: JSON.parse messages can quote part of the file (i.e. the token).
      throw new Error('credentials unreadable');
    }
    if (typeof token !== 'string') throw new Error('no OAuth access token available');
    const response = await fetch(USAGE_URL, {
      redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', Accept: 'application/json' },
      signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`usage API responded ${response.status}`);
    const body: any = await response.json().catch(() => null);
    const windows = toWindows(body);
    if (!windows.length) throw new Error('unexpected usage API response shape');
    live = { source: 'live', fetchedAtMs: Date.now(), windows };
    liveError = null;
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    // Only fixed, known messages reach the browser.
    liveError = KNOWN_ERROR_PATTERN.test(message) ? message : 'usage API unreachable';
  } finally {
    isPolling = false;
  }
}

/** Subscription usage windows from the live poll or the Claude Code cache, plus recent rate-limit hits. */
export function getLimits(): LimitsInfo {
  if (isLiveEnabled && Date.now() - lastPollMs > POLL_INTERVAL_MS) {
    lastPollMs = Date.now();
    void pollLive();
  }
  const cache = readCache();
  const snapshot = live && (!cache || live.fetchedAtMs >= cache.fetchedAtMs) ? live : cache;
  return {
    source: snapshot?.source ?? 'none',
    fetchedAtMs: snapshot?.fetchedAtMs ?? null,
    error: isLiveEnabled ? liveError : 'live polling off (DASHBOARD_LIVE_USAGE=0)',
    windows: snapshot?.windows ?? [],
    hits: limitHits.slice(-HITS_MAX),
  };
}
