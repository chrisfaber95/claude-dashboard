import type { SessionInfo } from '../../../shared/types/index.ts';
import { esc } from '../../shared/escape.ts';
import { moodOf, type SessionMood } from '../core/mood.logic.ts';
import { isBackgroundSession } from '../sessions/sessions.logic.ts';
import { ROOM_HEIGHT, ROOM_WIDTH, roomTooltip, sessionStatLine, tooltipAttribute, truncateWithEllipsis } from './building.logic.ts';

// Skin and hair variants; the colours live in style.scss (.skin-N, .hair-N).
const SKIN_VARIANTS = 4;
const HAIR_VARIANTS = 5;
const SHIRT_VARIANTS = 8;
const ROOM_NAME_MAX = 20;
const CODE_LINE_WIDTHS = [22, 30, 16, 26];

function codeLinesHtml(): string {
  return CODE_LINE_WIDTHS.map(
    (width, line) => `<rect class="room__code room__code--${line}" x="119" y="${65 + line * 5}" width="${width}" height="2" rx="1"/>`,
  ).join('');
}

function mugHtml(mood: SessionMood): string {
  if (mood === 'busy') return '';
  return `<g><rect class="room__mug" x="100" y="80" width="9" height="8" rx="2"/><path class="room__handle" d="M109 82h3v4h-3"/>
          <path class="room__steam" d="M103 77q-2-3 0-5"/></g>`;
}

function bubbleHtml(mood: SessionMood): string {
  if (mood === 'busy') {
    const dots = [0, 1, 2].map((dot) => `<circle class="room__dot room__dot--${dot}" cx="${95 + dot * 6}" cy="34" r="2"/>`).join('');
    return `<g class="room__bubble"><rect class="room__bubble-bg" x="86" y="26" width="30" height="16" rx="8"/>${dots}</g>`;
  }
  if (mood === 'waiting') {
    return `<g class="room__bubble room__bubble--ask"><rect class="room__bubble-bg room__bubble-bg--ask" x="86" y="26" width="30" height="16" rx="8"/><text class="room__ask" x="101" y="38" text-anchor="middle">?</text></g>`;
  }
  return `<g class="room__zzz"><text x="92" y="42">z</text><text x="100" y="34">z</text><text x="108" y="26">Z</text></g>`;
}

function hatHtml(isBackground: boolean, hair: number): string {
  if (isBackground) {
    return `<path class="room__hat" d="M70 58a9 9 0 0 1 18 0z"/><rect class="room__brim" x="68" y="57" width="22" height="3" rx="1.5"/>`;
  }
  return `<path class="hair-${hair}" d="M70 59a9 9 0 0 1 18-1q-5-6-18 1z"/>`;
}

/** The person at the desk of room number `index`; look and activity follow the session's mood. */
function workerHtml(index: number, mood: SessionMood, isBackground: boolean): string {
  const skin = index % SKIN_VARIANTS;
  const hair = index % HAIR_VARIANTS;
  const shirt = (index % SHIRT_VARIANTS) + 1;
  return `
    <rect class="room__chair" x="58" y="70" width="5" height="28" rx="2"/>
    <rect class="room__chair" x="58" y="94" width="26" height="4" rx="2"/>
    <rect class="room__chair" x="69" y="98" width="3" height="14"/>
    <rect class="room__legs" x="76" y="94" width="26" height="7" rx="3"/><rect class="room__legs" x="96" y="94" width="7" height="18" rx="3"/>
    <rect class="shirt-${shirt}" x="70" y="70" width="18" height="26" rx="7"/>
    <g class="room__head"><circle class="skin-${skin}" cx="79" cy="60" r="9"/>${hatHtml(isBackground, hair)}<circle class="room__eye" cx="83" cy="60" r="1.2"/></g>
    <rect class="room__desk" x="70" y="87" width="104" height="6" rx="2"/>
    <rect class="room__desk" x="76" y="93" width="4" height="19"/><rect class="room__desk" x="164" y="93" width="4" height="19"/>
    <rect class="room__desk" x="118" y="85" width="12" height="3"/>
    <rect class="room__monitor" x="112" y="58" width="46" height="30" rx="3"/>
    <rect class="room__screen" x="115" y="61" width="40" height="24" rx="1.5"/>
    ${mood === 'busy' ? codeLinesHtml() : ''}
    ${mugHtml(mood)}
    <g class="room__arms"><path class="room__arm arm-skin-${skin}" d="M83 78L106 86"/>
      <path class="room__arm room__arm--b sleeve-${shirt}" d="M80 80L102 87"/></g>
    ${bubbleHtml(mood)}`;
}

/** One session's room at (x, y): its worker, name, status and token line. */
export function roomHtml(session: SessionInfo, index: number, offsetX: number, offsetY: number): string {
  const mood = moodOf(session);
  const isBackground = isBackgroundSession(session);
  const label = `${session.name}, ${session.status}. Open transcript`;
  return `<g class="room room--${mood}" transform="translate(${offsetX} ${offsetY})" data-tip="${tooltipAttribute(roomTooltip(session))}" data-room="${esc(session.sessionId)}" data-name="${esc(session.name)}" tabindex="0" role="button" aria-label="${esc(label)}">
    <rect class="room__wall" width="${ROOM_WIDTH}" height="${ROOM_HEIGHT}" rx="4"/>
    <rect class="room__window" x="14" y="16" width="40" height="34" rx="2"/>
    <path class="room__pane" d="M34 16v34M14 33h40"/>
    <rect class="room__floor" y="112" width="${ROOM_WIDTH}" height="18"/>
    <rect class="room__pot" x="182" y="98" width="14" height="14" rx="2"/><circle class="room__leaf" cx="189" cy="92" r="9"/><circle class="room__leaf room__leaf--b" cx="184" cy="96" r="6"/>
    ${workerHtml(index, mood, isBackground)}
    <text class="room__name" x="10" y="13">${esc(truncateWithEllipsis(session.name, ROOM_NAME_MAX))}</text>
    <text class="room__state" x="${ROOM_WIDTH - 10}" y="13" text-anchor="end">${esc(session.status)}${isBackground ? ' · bg' : ''}</text>
    <text class="room__stat" x="10" y="125" data-stat="${esc(session.sessionId)}">${esc(sessionStatLine(session))}</text>
    <rect class="room__focus" width="${ROOM_WIDTH}" height="${ROOM_HEIGHT}" rx="4"/>
  </g>`;
}

/** The dark room shown when the project has no live session. */
export function emptyRoomHtml(offsetX: number, offsetY: number): string {
  return `<g class="room room--empty" transform="translate(${offsetX} ${offsetY})">
    <rect class="room__wall" width="${ROOM_WIDTH}" height="${ROOM_HEIGHT}" rx="4"/>
    <rect class="room__floor" y="112" width="${ROOM_WIDTH}" height="18"/>
    <rect class="room__window" x="14" y="16" width="40" height="34" rx="2"/>
    <rect class="room__desk" x="70" y="87" width="104" height="6" rx="2"/><rect class="room__desk" x="76" y="93" width="4" height="19"/><rect class="room__desk" x="164" y="93" width="4" height="19"/>
    <rect class="room__monitor" x="112" y="58" width="46" height="30" rx="3"/><rect class="room__screen room__screen--off" x="115" y="61" width="40" height="24" rx="1.5"/>
    <text class="room__name" x="10" y="13">Nobody here</text>
    <text class="room__state" x="${ROOM_WIDTH - 10}" y="13" text-anchor="end">lights off</text>
  </g>`;
}
