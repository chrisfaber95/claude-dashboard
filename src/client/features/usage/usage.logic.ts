// Pure series and stacking logic of the usage chart (no DOM): testable with node --test.
import type { UsageDay } from '../../../shared/types/index.ts';

export const OTHER_SERIES = 'Other';

/** One stacked bar piece: a series name and its tokens on that day. */
export interface BarSegment {
  name: string;
  tokens: number;
}

/** Tokens of a day that belong to projects the dashboard no longer lists. */
export function otherTokensOfDay(day: UsageDay, projectNames: readonly string[]): number {
  return Object.entries(day.byProject)
    .filter(([name]) => !projectNames.includes(name))
    .reduce((sum, [, tokens]) => sum + tokens, 0);
}

/** Projects that have tokens on at least one of the days, in project order. */
export function seriesNames(days: readonly UsageDay[], projectNames: readonly string[]): string[] {
  return projectNames.filter((name) => days.some((day) => (day.byProject[name] ?? 0) > 0));
}

/** Total of the series that are still shown on one day. */
export function visibleDayTotal(day: UsageDay, visibleNames: readonly string[], projectNames: readonly string[], isOtherHidden: boolean): number {
  const otherTokens = isOtherHidden ? 0 : otherTokensOfDay(day, projectNames);
  return visibleNames.reduce((sum, name) => sum + (day.byProject[name] ?? 0), 0) + otherTokens;
}

/** The non-empty bar pieces of one day, in stacking order (projects, then Other). */
export function daySegments(day: UsageDay, visibleNames: readonly string[], projectNames: readonly string[], isOtherHidden: boolean): BarSegment[] {
  const segments: BarSegment[] = visibleNames.map((name) => ({ name, tokens: day.byProject[name] ?? 0 }));
  if (!isOtherHidden) segments.push({ name: OTHER_SERIES, tokens: otherTokensOfDay(day, projectNames) });
  return segments.filter((segment) => segment.tokens > 0);
}
