// Pure alert logic (no DOM): testable with node --test.
import type { Alert } from '../../../shared/types/index.ts';

export const badgeCount = (items: readonly Alert[]): number => items.length;

/**
 * Remembers which alert ids the page has already seen. The first state after page load is only a baseline, so a
 * reload never re-toasts alerts that were already open; later states return the alerts whose id was not in the
 * previous state (an alert that clears and comes back is new again).
 */
export function createAlertTracker() {
  let seen: Set<string> | null = null;
  return {
    update(items: readonly Alert[]): Alert[] {
      const prev = seen;
      seen = new Set(items.map((a) => a.id));
      if (!prev) return [];
      return items.filter((a) => !prev.has(a.id));
    },
  };
}
