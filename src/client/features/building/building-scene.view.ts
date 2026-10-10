import type { SessionInfo, SubagentInfo } from '../../../shared/types/index.ts';
import { esc } from '../../shared/escape.ts';
import { annexHtml } from './building-annex.view.ts';
import { emptyRoomHtml, roomHtml } from './building-room.view.ts';
import {
  ANNEX_ROW_HEIGHT,
  BASE_HEIGHT,
  BUILDING_PADDING,
  ROOF_HEIGHT,
  ROOM_GAP,
  ROOM_HEIGHT,
  ROOM_WIDTH,
  annexRowCount,
  buildingAriaLabel,
  columnCount,
  truncateWithEllipsis,
} from './building.logic.ts';

const TITLE_MAX = 26;
const SIGN_TOP = 22;
const DOOR_WIDTH = 32;

interface FloorLayout {
  floorTops: Map<number, number>;
  roomsBottom: number;
}

/** First sessions get the ground floor (row 0, at the bottom); later ones stack on top. A floor is as tall as its tallest room plus that room's annex. */
function floorLayout(sessions: SessionInfo[], subagents: SubagentInfo[], columns: number, rows: number): FloorLayout {
  const subagentsOf = (session: SessionInfo) => subagents.filter((subagent) => subagent.sessionId === session.sessionId);
  const floorHeights = Array.from({ length: rows }, (_, row) => {
    const here = sessions.slice(row * columns, row * columns + columns);
    return ROOM_HEIGHT + Math.max(0, ...here.map((session) => annexRowCount(subagentsOf(session).length) * ANNEX_ROW_HEIGHT));
  });
  const floorTops = new Map<number, number>();
  let top = ROOF_HEIGHT + ROOM_GAP;
  for (let row = rows - 1; row >= 0; row--) {
    floorTops.set(row, top);
    top += floorHeights[row] + ROOM_GAP;
  }
  return { floorTops, roomsBottom: top - ROOM_GAP };
}

function cellsHtml(sessions: SessionInfo[], subagents: SubagentInfo[], columns: number, layout: FloorLayout): string {
  const subagentsById = new Map(subagents.map((subagent) => [subagent.agentId, subagent]));
  let cells = '';
  for (let slot = 0; slot < Math.max(1, sessions.length); slot++) {
    const roomX = BUILDING_PADDING + (slot % columns) * (ROOM_WIDTH + ROOM_GAP);
    const roomY = layout.floorTops.get(Math.floor(slot / columns))!;
    if (!sessions.length) {
      cells += emptyRoomHtml(roomX, roomY);
      continue;
    }
    cells += roomHtml(sessions[slot], slot, roomX, roomY);
    const own = subagents.filter((subagent) => subagent.sessionId === sessions[slot].sessionId);
    if (own.length) cells += `<g class="annex" transform="translate(${roomX} ${roomY})">${annexHtml(own, subagentsById)}</g>`;
  }
  return cells;
}

/** The whole building as one SVG: sign, one room per session with its annex, base and door. */
export function sceneHtml(name: string, sessions: SessionInfo[], subagents: SubagentInfo[], tintClass: string): string {
  const columns = columnCount(sessions.length);
  const rows = Math.max(1, Math.ceil(sessions.length / columns));
  const width = BUILDING_PADDING * 2 + columns * ROOM_WIDTH + (columns - 1) * ROOM_GAP;
  const layout = floorLayout(sessions, subagents, columns, rows);
  const { roomsBottom } = layout;
  const height = roomsBottom + ROOM_GAP + BASE_HEIGHT;
  const doorX = width / 2 - 16;
  const label = truncateWithEllipsis(name, TITLE_MAX);

  return `<svg class="building__svg building__svg--cols-${columns}" viewBox="0 0 ${width} ${height}" role="group" aria-label="${esc(buildingAriaLabel(name, sessions.length, subagents.length))}">
    <g class="building__clouds"><ellipse class="cloud" cx="40" cy="30" rx="26" ry="9"/><ellipse class="cloud cloud--b" cx="${width - 60}" cy="52" rx="32" ry="10"/></g>
    <rect class="building__antenna" x="${width / 2 - 1.5}" y="2" width="3" height="22"/><circle class="building__beacon" cx="${width / 2}" cy="3" r="3.5"/>
    <rect class="building__sign ${tintClass}" x="${BUILDING_PADDING}" y="${SIGN_TOP}" width="${width - BUILDING_PADDING * 2}" height="${ROOF_HEIGHT - SIGN_TOP}" rx="6"/>
    <text class="building__title" x="${width / 2}" y="${SIGN_TOP + (ROOF_HEIGHT - SIGN_TOP) / 2 + 6}" text-anchor="middle">${esc(label)}</text>
    <rect class="building__body" x="2" y="${ROOF_HEIGHT - 2}" width="${width - 4}" height="${roomsBottom - ROOF_HEIGHT + ROOM_GAP + 4}" rx="3"/>
    ${cellsHtml(sessions, subagents, columns, layout)}
    <rect class="building__base" x="0" y="${roomsBottom + ROOM_GAP}" width="${width}" height="${BASE_HEIGHT}"/>
    <rect class="building__door" x="${doorX}" y="${roomsBottom + ROOM_GAP + 4}" width="${DOOR_WIDTH}" height="${BASE_HEIGHT - 4}" rx="3"/>
    <circle class="building__knob" cx="${doorX + 25}" cy="${roomsBottom + ROOM_GAP + 18}" r="1.8"/>
  </svg>`;
}
