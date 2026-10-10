import { resetAggregates } from './transcript-aggregates.ts';
import { resetScanner } from './transcript-scanner.ts';
import { resetSubagents } from './subagent-index.ts';

export * from './transcript-aggregates.ts';
export { scanTranscripts } from './transcript-scanner.ts';
export { buildSubagents, subagentPaths } from './subagent-index.ts';

/** Drop all aggregated state so the next scan starts from scratch. */
export function resetTranscripts(): void {
  resetScanner();
  resetAggregates();
  resetSubagents();
}
