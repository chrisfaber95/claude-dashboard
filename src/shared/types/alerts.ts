export type AlertKind = 'session' | 'usage' | 'ticket' | 'signin';

/** Something that needs the user. The id is deterministic per condition, so it never duplicates. */
export interface Alert {
  /** `session:<sessionId>`, `usage:<windowKey>`, `ticket:<T-id>` or `signin:<address>`. */
  id: string;
  kind: AlertKind;
  /** Session name, limit window label or ticket id. */
  title: string;
  /** What is wrong, e.g. "Waiting for you", "87% used" or the ticket title. */
  detail: string;
  /** When the condition started (the first state build that saw it when the source has no time). */
  sinceMs: number;
  /** Usage alerts: when the window resets. */
  resetsAtMs: number | null;
}

export interface AlertsInfo {
  items: Alert[];
  /** Usage percentage (1-100) at which a limit window raises an alert. */
  threshold: number;
}
