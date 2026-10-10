/** One command-log entry as served by `GET /api/audit`: allowlisted fields only. */
export interface AuditEntry {
  ts: string;
  action: string;
  /** Name of the device that did it. */
  device?: string;
  /** Id of that device; `pc` for this PC (loopback). */
  deviceId?: string;
  project?: string;
  session?: string;
  mode?: string;
  ok?: boolean;
  /** Cut to 200 characters. */
  prompt?: string;
  /** Launch goal, cut to 500 characters (start entries). */
  goal?: string;
  /** Length of the launch notes; the notes text is never logged. */
  notesLength?: number;
  /** Name of the tool a permission request asked for (approval entries), cut to 100 characters. */
  tool?: string;
  /** Text of a permission request, cut to 500 characters; untrusted, show it with `esc()`. */
  text?: string;
  /** How a permission request ended: `allow`, `deny` or `expired`. */
  outcome?: string;
}
