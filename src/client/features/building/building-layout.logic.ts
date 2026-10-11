// Pure geometry of the building scene (no DOM): where each room, cubicle and pipe sits, testable with node --test.
import type { SessionInfo, SubagentInfo } from '../../../shared/types/index.ts';
import {
  ANNEX_ROW_HEIGHT,
  BASE_HEIGHT,
  BUILDING_PADDING,
  CUBICLE_GAP,
  CUBICLE_HEIGHT,
  CUBICLE_WIDTH,
  CUBICLES_PER_ROW,
  ROOF_HEIGHT,
  ROOM_GAP,
  ROOM_HEIGHT,
  ROOM_WIDTH,
  annexRowCount,
  columnCount,
} from './building.logic.ts';

const CUBICLE_TOP_OFFSET = 18;
const BUS_OFFSET = 6;
const TRUNK_X = -5;
const PIPE_EXIT_OFFSET = 6;

/** One room position; `session` is null for the dark room of a project without live sessions. */
export interface RoomSlot {
  session: SessionInfo | null;
  index: number;
  x: number;
  y: number;
  subagents: SubagentInfo[];
}

export interface SceneGeometry {
  columns: number;
  width: number;
  height: number;
  roomsBottom: number;
  slots: RoomSlot[];
}

function subagentsOfSession(subagents: SubagentInfo[], session: SessionInfo): SubagentInfo[] {
  return subagents.filter((subagent) => subagent.sessionId === session.sessionId);
}

/** Top of every floor, keyed by row. Row 0 (first sessions) is the ground floor at the bottom; a floor is as tall as its tallest room plus that room's annex. */
function floorTops(sessions: SessionInfo[], subagents: SubagentInfo[], columns: number, rows: number): { tops: number[]; roomsBottom: number } {
  const floorHeights = Array.from({ length: rows }, (_, row) => {
    const here = sessions.slice(row * columns, row * columns + columns);
    const annexHeights = here.map((session) => annexRowCount(subagentsOfSession(subagents, session).length) * ANNEX_ROW_HEIGHT);
    return ROOM_HEIGHT + Math.max(0, ...annexHeights);
  });
  const tops: number[] = [];
  let top = ROOF_HEIGHT + ROOM_GAP;
  for (let row = rows - 1; row >= 0; row--) {
    tops[row] = top;
    top += floorHeights[row] + ROOM_GAP;
  }
  return { tops, roomsBottom: top - ROOM_GAP };
}

/** Size of the building and the place of every room. */
export function sceneGeometry(sessions: SessionInfo[], subagents: SubagentInfo[]): SceneGeometry {
  const columns = columnCount(sessions.length);
  const rows = Math.max(1, Math.ceil(sessions.length / columns));
  const width = BUILDING_PADDING * 2 + columns * ROOM_WIDTH + (columns - 1) * ROOM_GAP;
  const { tops, roomsBottom } = floorTops(sessions, subagents, columns, rows);
  const slotCount = Math.max(1, sessions.length);
  const slots = Array.from({ length: slotCount }, (_, index): RoomSlot => {
    const session = sessions[index] ?? null;
    return {
      session,
      index,
      x: BUILDING_PADDING + (index % columns) * (ROOM_WIDTH + ROOM_GAP),
      y: tops[Math.floor(index / columns)] ?? 0,
      subagents: session ? subagentsOfSession(subagents, session) : [],
    };
  });
  return { columns, width, height: roomsBottom + ROOM_GAP + BASE_HEIGHT, roomsBottom, slots };
}

export interface CubicleLayout {
  subagent: SubagentInfo;
  x: number;
  y: number;
  bus: number;
  row: number;
  column: number;
  isNested: boolean;
}

export interface MailLayout {
  agentId: string;
  x: number;
  y: number;
  column: number;
}

export interface AnnexLayout {
  cubicles: CubicleLayout[];
  pipePaths: string[];
  nestedPipePaths: string[];
  mail: MailLayout[];
}

function mainSessionPipePaths(fromMain: CubicleLayout[]): string[] {
  const busRows = [...new Set(fromMain.map((cubicle) => cubicle.row))];
  if (!busRows.length) return [];
  const lastBus = ROOM_HEIGHT + Math.max(...busRows) * ANNEX_ROW_HEIGHT + BUS_OFFSET;
  const paths = [`M0 ${ROOM_HEIGHT - PIPE_EXIT_OFFSET}H${TRUNK_X}V${lastBus}`];
  for (const row of busRows) {
    const mine = fromMain.filter((cubicle) => cubicle.row === row);
    const bus = ROOM_HEIGHT + row * ANNEX_ROW_HEIGHT + BUS_OFFSET;
    const stubs = mine.map((cubicle) => `M${cubicle.x + CUBICLE_WIDTH / 2} ${bus}V${cubicle.y}`).join('');
    const busEnd = Math.max(...mine.map((cubicle) => cubicle.x + CUBICLE_WIDTH / 2));
    paths.push(`M${TRUNK_X} ${bus}H${busEnd}${stubs}`);
  }
  return paths;
}

function nestedPipePath(parent: CubicleLayout, child: CubicleLayout): string {
  if (parent.row === child.row) return `M${parent.x + CUBICLE_WIDTH} ${parent.y + CUBICLE_HEIGHT / 2}H${child.x}`;
  return `M${parent.x + CUBICLE_WIDTH / 2} ${parent.y + CUBICLE_HEIGHT}V${child.bus}H${child.x + CUBICLE_WIDTH / 2}V${child.y}`;
}

/** The cubicles of one session, in the space under its room (local coordinates start at the room's top-left), with the pipes and mail between them. */
export function annexLayout(subagents: SubagentInfo[]): AnnexLayout {
  const knownIds = new Set(subagents.map((subagent) => subagent.agentId));
  const cubicles = subagents.map((subagent, index): CubicleLayout => {
    const row = Math.floor(index / CUBICLES_PER_ROW);
    const column = index % CUBICLES_PER_ROW;
    const rowTop = ROOM_HEIGHT + row * ANNEX_ROW_HEIGHT;
    return {
      subagent,
      x: column * (CUBICLE_WIDTH + CUBICLE_GAP),
      y: rowTop + CUBICLE_TOP_OFFSET,
      bus: rowTop + BUS_OFFSET,
      row,
      column,
      isNested: Boolean(subagent.parentAgentId && knownIds.has(subagent.parentAgentId)),
    };
  });
  const byId = new Map(cubicles.map((cubicle) => [cubicle.subagent.agentId, cubicle]));
  const fromMain = cubicles.filter((cubicle) => !cubicle.isNested);
  const nestedPipePaths = cubicles.flatMap((cubicle) => {
    const parent = cubicle.isNested ? byId.get(cubicle.subagent.parentAgentId ?? '') : undefined;
    return parent ? [nestedPipePath(parent, cubicle)] : [];
  });
  const mail = fromMain
    .filter((cubicle) => cubicle.subagent.state === 'working')
    .map((cubicle): MailLayout => ({ agentId: cubicle.subagent.agentId, x: cubicle.x + CUBICLE_WIDTH / 2, y: cubicle.bus, column: cubicle.column }));
  return { cubicles, pipePaths: mainSessionPipePaths(fromMain), nestedPipePaths, mail };
}
