export const PERMISSION_MODES = ['plan', 'default', 'acceptEdits', 'auto'] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export interface CommandResult {
  ok: boolean;
  output: string;
  /** Background session id when the CLI printed one. */
  id?: string;
  /** Set when the CLI refused because the folder isn't trusted yet. */
  needsTrust?: string;
  /** Start requests only: false means the launch failed and no session was left behind. */
  started?: boolean;
}
