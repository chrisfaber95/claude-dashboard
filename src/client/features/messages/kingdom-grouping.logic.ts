// Pure rules of the kingdom: which court or district a session belongs to and what kind of building it is.
export const COURT_ID = '@court';
export const OTHER_DISTRICT = 'other';
const TEAM_PROJECT = 'team-hq';
const ENGINEER_PREFIX = 'eng-';
const REVIEWER_PREFIX = 'reviewer-';

export type BuildingKind = 'hall' | 'workshop' | 'guild' | 'house';

/** True for the team-hq roles: lead, designer, reviewer, reviewer-* and eng-*. */
export function isCourtName(name: string): boolean {
  if (name === 'lead' || name === 'designer' || name === 'reviewer') return true;
  return name.startsWith(REVIEWER_PREFIX) || name.startsWith(ENGINEER_PREFIX);
}

/** Court id for team-hq sessions, else the project's district; `project` is null when it is unknown. */
export function areaIdOf(name: string, project: string | null): string {
  if (project === TEAM_PROJECT || isCourtName(name)) return COURT_ID;
  return project === null || project === '' ? OTHER_DISTRICT : project;
}

/** The building kind by session name: hall for lead, workshop for engineers, guild for reviewers and designer. */
export function buildingKindOf(name: string): BuildingKind {
  if (name === 'lead') return 'hall';
  if (name.startsWith(ENGINEER_PREFIX)) return 'workshop';
  if (name === 'designer' || name === 'reviewer' || name.startsWith(REVIEWER_PREFIX)) return 'guild';
  return 'house';
}
