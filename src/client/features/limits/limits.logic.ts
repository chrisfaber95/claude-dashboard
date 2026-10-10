// Pure limit-gauge logic (no DOM): testable with node --test.
import type { LimitWindow } from '../../../shared/types/index.ts';

const PERCENT_MAX = 100;
const CRITICAL_PERCENT = 90;
const WARNING_PERCENT = 75;

/** A utilization clamped to 0..100. */
export function clampPercent(utilization: number): number {
  return Math.max(0, Math.min(PERCENT_MAX, utilization));
}

/** CSS state class of a gauge: critical from 90 %, warning from 75 %, otherwise none. */
export function limitLevelClass(percent: number): string {
  if (percent >= CRITICAL_PERCENT) return 'is-crit';
  if (percent >= WARNING_PERCENT) return 'is-warn';
  return '';
}

/** Short status text appended to a gauge's reset time. */
export function limitStatusText(percent: number): string {
  if (percent >= CRITICAL_PERCENT) return ' · near limit';
  if (percent >= WARNING_PERCENT) return ' · high';
  return '';
}

/** The highest clamped utilization over all windows; 0 when there are none. */
export function highestUtilization(windows: readonly LimitWindow[]): number {
  return windows.reduce((highest, window) => Math.max(highest, clampPercent(window.utilization)), 0);
}
