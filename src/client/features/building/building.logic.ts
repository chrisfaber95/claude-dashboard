// Pure geometry, text and tooltip logic of the building popup (no DOM): testable with node --test.
import type { ProjectInfo, SessionInfo, SubagentInfo } from '../../../shared/types/index.ts';
import { formatTokenCount, sumTokens } from '../../shared/token-format.ts';
import { isBackgroundSession } from '../sessions/sessions.logic.ts';
import { moodOf } from '../core/mood.logic.ts';

// Room geometry (SVG units).
export const ROOM_WIDTH = 210;
export const ROOM_HEIGHT = 130;
export const ROOM_GAP = 10;
export const BUILDING_PADDING = 14;
export const ROOF_HEIGHT = 74;
export const BASE_HEIGHT = 30;

// Subagent annex under a room: cubicles in rows of three, joined to the room by pipes.
export const CUBICLE_WIDTH = 66;
export const CUBICLE_GAP = 6;
export const CUBICLE_HEIGHT = 70;
export const ANNEX_ROW_HEIGHT = 92;
export const CUBICLES_PER_ROW = 3;

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const MS_PER_SECOND = 1000;
const HUE_MULTIPLIER = 31;
const HUE_COUNT = 8;
const CUBICLE_LABEL_MAX = 15;
const ONE_COLUMN_MAX = 1;
const TWO_COLUMNS_MAX = 4;
const THREE_COLUMNS_MAX = 9;

/** Shorten `text` to at most `maxLength` characters, ending in an ellipsis when it was cut. */
export const truncateWithEllipsis = (text: string, maxLength: number) => (text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text);

/** "1h 5m" for the time since a session started; never negative. */
export function formatSessionUptime(startedAtMs: number): string {
  const seconds = Math.max(0, (Date.now() - startedAtMs) / MS_PER_SECOND);
  const hours = Math.floor(seconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** Tooltip text, one line per entry. It is shown with textContent. */
export const tooltipText = (lines: (string | false)[]) => lines.filter(Boolean).join('\n');

/** The "12k tokens · up 5m" line of a room. */
export function sessionStatLine(session: SessionInfo): string {
  return `${formatTokenCount(sumTokens(session.tokens))} tokens · up ${formatSessionUptime(session.startedAtMs)}`;
}

/** Tooltip of a room. */
export function roomTooltip(session: SessionInfo): string {
  const background = isBackgroundSession(session) ? ' · background' : '';
  const branch = session.branch ? ` · ${session.branch}` : '';
  return tooltipText([session.name, `${session.status}${background}${branch}`, sessionStatLine(session), 'Click to read the transcript']);
}

function subagentOutcome(subagent: SubagentInfo): string {
  if (subagent.state === 'working') return subagent.activity && `Now: ${subagent.activity}`;
  if (!subagent.handedBack) return 'No activity for 5 minutes and nothing handed back';
  return subagent.result ? `Handed back: ${subagent.result}` : 'Handed back (no report text recorded)';
}

/** Tooltip of a subagent cubicle. */
export function subagentTooltip(subagent: SubagentInfo, subagentsById: Map<string, SubagentInfo>): string {
  const parentLabel = subagent.parentAgentId
    ? `subagent ${subagentsById.get(subagent.parentAgentId)?.agentType ?? subagent.parentAgentId.slice(0, 8)}`
    : 'the main session';
  return tooltipText([
    `${subagent.agentType} · ${subagent.state}${subagent.background ? ' · background' : ''}`,
    subagent.description,
    `Handed down by: ${parentLabel}`,
    subagent.prompt && `Brief: ${subagent.prompt}`,
    subagentOutcome(subagent),
    `${formatTokenCount(subagent.tokens)} tokens`,
    'Click to read what it did',
  ]);
}

/** Colour slot (1..8) of an agent type, stable across pushes. */
export function agentTypeHue(agentType: string): number {
  let hash = 0;
  for (const character of agentType) hash = (hash * HUE_MULTIPLIER + character.charCodeAt(0)) >>> 0;
  return (hash % HUE_COUNT) + 1;
}

/** The short activity text under a cubicle. */
export function cubicleLabel(subagent: SubagentInfo): string {
  if (subagent.state === 'working') return truncateWithEllipsis(subagent.activity || 'working…', CUBICLE_LABEL_MAX);
  return truncateWithEllipsis(subagent.handedBack ? 'handed back' : 'quiet', CUBICLE_LABEL_MAX);
}

/** Status of a cubicle's dot: working, done (handed back) or quiet. */
export function cubicleDotState(subagent: SubagentInfo): 'working' | 'done' | 'quiet' {
  if (subagent.state === 'working') return 'working';
  return subagent.handedBack ? 'done' : 'quiet';
}

/** Rooms per floor for a building with `sessionCount` sessions. */
export function columnCount(sessionCount: number): number {
  if (sessionCount <= ONE_COLUMN_MAX) return 1;
  if (sessionCount <= TWO_COLUMNS_MAX) return 2;
  return sessionCount <= THREE_COLUMNS_MAX ? 3 : 4;
}

/** Rows of cubicles needed for `subagentCount` subagents. */
export const annexRowCount = (subagentCount: number) => Math.ceil(subagentCount / CUBICLES_PER_ROW);

/** "3 sessions" or "1 session". */
const countOf = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** ARIA label of the building drawing. */
export function buildingAriaLabel(name: string, sessionCount: number, subagentCount: number): string {
  return `${name} building with ${countOf(sessionCount, 'session')} and ${countOf(subagentCount, 'subagent')}`;
}

/** The line under the building title: counts of sessions, working, waiting and subagents, and the branch. */
export function buildingSubtitle(project: ProjectInfo, sessions: SessionInfo[], subagents: SubagentInfo[]): string {
  if (!sessions.length) return 'No live sessions: the building is empty.';
  const workingCount = sessions.filter((session) => moodOf(session) === 'busy').length;
  const waitingCount = sessions.filter((session) => moodOf(session) === 'waiting').length;
  const subagentsWorkingCount = subagents.filter((subagent) => subagent.state === 'working').length;
  const waiting = waitingCount ? ` · ${waitingCount} waiting for you` : '';
  const subagentText = subagents.length ? ` · ${countOf(subagents.length, 'subagent')} (${subagentsWorkingCount} working)` : '';
  const branch = project.branch ? ` · ${project.branch}` : '';
  return `${countOf(sessions.length, 'session')} in the building · ${workingCount} working${waiting}${subagentText}${branch}`;
}
