export const TEAM_COLUMNS = ['backlog', 'ready', 'in-progress', 'review', 'done', 'blocked'] as const;
export type TeamColumn = (typeof TEAM_COLUMNS)[number];

export interface TeamTicket {
  id: string;
  title: string;
}

/** Read-only summary of the team-hq board. */
export interface TeamBoard {
  counts: Record<TeamColumn, number>;
  active: { inProgress: TeamTicket[]; review: TeamTicket[]; blocked: TeamTicket[] };
  needsYou: string[];
}
