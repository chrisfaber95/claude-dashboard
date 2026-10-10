export type PermissionRequestStatus = 'pending' | 'expired';

export interface PermissionRequestInfo {
  id: string;
  sessionId: string;
  tool: string;
  /** What the session wants to do, as plain text (untrusted, show with esc()). */
  text: string;
  createdMs: number;
  status: PermissionRequestStatus;
}
