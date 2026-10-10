/** How session summaries are made: `recap` from the transcript without a model, `model` by one cheap-model CLI call. */
export type SummaryMode = 'recap' | 'model';
export const SUMMARY_MODES: readonly SummaryMode[] = ['recap', 'model'];

/** Answer of GET /api/sessions/:id/summary. `mode` is how this answer was made (a failed model call falls back to `recap` with a `note`). */
export interface SessionSummary {
  mode: SummaryMode;
  text: string;
  note?: string;
}

/** Answer of GET /api/settings/summary and body of POST /api/settings/summary. */
export interface SummarySetting {
  summary: SummaryMode;
}
