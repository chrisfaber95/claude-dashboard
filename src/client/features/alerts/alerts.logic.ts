// Pure alert logic (no DOM): testable with node --test.
import type { Alert } from '../../../shared/types/index.ts';

/** Lowest and highest usage percentage the threshold form accepts. */
export const MIN_THRESHOLD = 1;
export const MAX_THRESHOLD = 100;

export const badgeCount = (items: readonly Alert[]): number => items.length;

/** The alerts without repeated ids; the first one with an id wins. */
export function uniqueAlerts(items: readonly Alert[]): Alert[] {
  const seenIds = new Set<string>();
  return items.filter((item) => !seenIds.has(item.id) && seenIds.add(item.id));
}

/** The threshold typed in the form, or null when it is not a whole number from 1 to 100. */
export function parseThreshold(text: string): number | null {
  const threshold = Number(text);
  const isValid = Number.isInteger(threshold) && threshold >= MIN_THRESHOLD && threshold <= MAX_THRESHOLD;
  return isValid ? threshold : null;
}

/** Tracks which alerts are new since the previous state. */
export interface AlertTracker {
  update(items: readonly Alert[]): Alert[];
}

/**
 * Remembers which alert ids the page has already seen. The first state after page load is only a baseline, so a
 * reload never re-toasts alerts that were already open; later states return the alerts whose id was not in the
 * previous state (an alert that clears and comes back is new again).
 */
export function createAlertTracker(): AlertTracker {
  let seenIds: Set<string> | null = null;
  return {
    update(items: readonly Alert[]): Alert[] {
      const previousIds = seenIds;
      seenIds = new Set(items.map((item) => item.id));
      if (!previousIds) return [];
      return items.filter((item) => !previousIds.has(item.id));
    },
  };
}
