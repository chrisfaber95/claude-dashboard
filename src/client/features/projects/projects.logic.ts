import type { SubagentInfo } from '../../../shared/types/index.ts';

/** Tooltip on the "not trusted" note of a project card. */
export const TRUST_TOOLTIP = 'Run claude once in this folder and accept the trust prompt to allow background tasks.';

/** How many subagents of `projectName` are working right now. */
export function countWorkingSubagents(subagents: readonly SubagentInfo[], projectName: string): number {
  return subagents.filter((subagent) => subagent.project === projectName && subagent.state === 'working').length;
}

/** The " · 2 subagents working" suffix of a project card; empty when none work. */
export function subagentsText(workingCount: number): string {
  if (!workingCount) return '';
  return ` · ${workingCount} subagent${workingCount === 1 ? '' : 's'} working`;
}
