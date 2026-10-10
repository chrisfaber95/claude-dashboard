import type { SubagentInfo } from '../../../shared/types/index.ts';
import { esc } from '../../shared/escape.ts';
import {
  ANNEX_ROW_HEIGHT,
  CUBICLE_GAP,
  CUBICLE_HEIGHT,
  CUBICLE_WIDTH,
  CUBICLES_PER_ROW,
  ROOM_HEIGHT,
  agentTypeHue,
  cubicleDotState,
  cubicleLabel,
  subagentTooltip,
  tooltipAttribute,
  truncateWithEllipsis,
} from './building.logic.ts';

const AGENT_TYPE_LABEL_MAX = 11;
const CUBICLE_TOP_OFFSET = 18;
const BUS_OFFSET = 6;
const TRUNK_X = -5;
const CODE_LINE_WIDTHS = [8, 11, 6];

interface CubiclePosition {
  x: number;
  y: number;
  bus: number;
  row: number;
}

type PositionsById = Map<string, CubiclePosition>;

function cubiclePositions(subagents: SubagentInfo[]): PositionsById {
  return new Map(
    subagents.map((subagent, index) => {
      const row = Math.floor(index / CUBICLES_PER_ROW);
      const rowTop = ROOM_HEIGHT + row * ANNEX_ROW_HEIGHT;
      const position = { x: (index % CUBICLES_PER_ROW) * (CUBICLE_WIDTH + CUBICLE_GAP), y: rowTop + CUBICLE_TOP_OFFSET, bus: rowTop + BUS_OFFSET, row };
      return [subagent.agentId, position] as const;
    }),
  );
}

function cubicleCodeHtml(): string {
  return CODE_LINE_WIDTHS.map(
    (width, line) => `<rect class="room__code room__code--${line}" x="40" y="${30 + line * 3.5}" width="${width}" height="1.4" rx="0.7"/>`,
  ).join('');
}

/** One subagent at its desk: a small robot that types while it works and shows a tick once it has handed back. */
function cubicleHtml(subagent: SubagentInfo, position: CubiclePosition, subagentsById: Map<string, SubagentInfo>): string {
  const isWorking = subagent.state === 'working';
  const color = agentTypeHue(subagent.agentType);
  const childClass = subagent.parentAgentId ? ' annex__cube--child' : '';
  const name = `${subagent.agentType}: ${subagent.description || subagent.agentId}`;
  const label = `${subagent.agentType}, ${subagent.state}. Open what it did`;
  const tick = subagent.handedBack && !isWorking ? `<path class="annex__tick" d="M${CUBICLE_WIDTH - 8.6} 7l1.9 1.9 3.4-3.8"/>` : '';
  return `<g class="annex__cube annex__cube--${subagent.state}${childClass}" transform="translate(${position.x} ${position.y})" data-tip="${tooltipAttribute(subagentTooltip(subagent, subagentsById))}" data-sub="${esc(subagent.agentId)}" data-name="${esc(name)}" tabindex="0" role="button" aria-label="${esc(label)}">
    <rect class="annex__wall" width="${CUBICLE_WIDTH}" height="${CUBICLE_HEIGHT}" rx="4"/>
    <text class="annex__type" x="4" y="10">${esc(truncateWithEllipsis(subagent.agentType, AGENT_TYPE_LABEL_MAX))}</text>
    <circle class="annex__dot annex__dot--${cubicleDotState(subagent)}" cx="${CUBICLE_WIDTH - 6}" cy="7" r="4"/>
    ${tick}
    <rect class="annex__desk" x="22" y="46" width="40" height="4" rx="1"/><rect class="annex__desk" x="25" y="50" width="3" height="8"/><rect class="annex__desk" x="56" y="50" width="3" height="8"/>
    <rect class="room__monitor" x="36" y="26" width="22" height="16" rx="2"/><rect class="room__screen${isWorking ? '' : ' room__screen--off'}" x="38" y="28" width="18" height="12" rx="1"/>
    <rect class="annex__desk" x="45" y="42" width="4" height="4"/>
    ${isWorking ? cubicleCodeHtml() : ''}
    <line class="annex__antenna" x1="17" y1="16" x2="17" y2="19"/><circle class="shirt-${color}" cx="17" cy="15" r="2"/>
    <rect class="annex__head" x="11" y="19" width="12" height="11" rx="3"/>
    <circle class="annex__eye" cx="15" cy="24" r="1.3"/><circle class="annex__eye" cx="20" cy="24" r="1.3"/>
    <rect class="shirt-${color}" x="10" y="31" width="14" height="15" rx="3"/>
    <rect class="annex__arm shirt-${color}" x="22" y="39" width="15" height="3.2" rx="1.6"/>
    <text class="annex__activity" x="4" y="${CUBICLE_HEIGHT - 4}" data-act="${esc(subagent.agentId)}">${esc(cubicleLabel(subagent))}</text>
  </g>`;
}

/** Pipes from the room down a trunk to a bus per row, with a stub into each cubicle the main session handed work to. */
function mainSessionPipesHtml(fromMain: SubagentInfo[], positions: PositionsById): string {
  const busRows = [...new Set(fromMain.map((subagent) => positions.get(subagent.agentId)!.row))];
  if (!busRows.length) return '';
  const lastBus = ROOM_HEIGHT + Math.max(...busRows) * ANNEX_ROW_HEIGHT + BUS_OFFSET;
  let pipes = `<path class="annex__pipe" d="M0 ${ROOM_HEIGHT - 6}H${TRUNK_X}V${lastBus}"/>`;
  for (const row of busRows) {
    const mine = fromMain.map((subagent) => positions.get(subagent.agentId)!).filter((position) => position.row === row);
    const bus = ROOM_HEIGHT + row * ANNEX_ROW_HEIGHT + BUS_OFFSET;
    const stubs = mine.map((position) => `M${position.x + CUBICLE_WIDTH / 2} ${bus}V${position.y}`).join('');
    pipes += `<path class="annex__pipe" d="M${TRUNK_X} ${bus}H${Math.max(...mine.map((position) => position.x + CUBICLE_WIDTH / 2))}${stubs}"/>`;
  }
  return pipes;
}

/** A subagent started by another subagent hangs off its parent's cubicle with a dashed pipe. */
function nestedPipesHtml(nested: SubagentInfo[], positions: PositionsById): string {
  return nested
    .map((subagent) => {
      const parent = positions.get(subagent.parentAgentId!)!;
      const child = positions.get(subagent.agentId)!;
      const path =
        parent.row === child.row
          ? `M${parent.x + CUBICLE_WIDTH} ${parent.y + CUBICLE_HEIGHT / 2}H${child.x}`
          : `M${parent.x + CUBICLE_WIDTH / 2} ${parent.y + CUBICLE_HEIGHT}V${child.bus}H${child.x + CUBICLE_WIDTH / 2}V${child.y}`;
      return `<path class="annex__pipe annex__pipe--nested" d="${path}"/>`;
    })
    .join('');
}

/** Envelopes ride down the stub while the work is being handed over. */
function mailHtml(fromMain: SubagentInfo[], positions: PositionsById): string {
  return fromMain
    .filter((subagent) => subagent.state === 'working')
    .map((subagent) => {
      const position = positions.get(subagent.agentId)!;
      const column = (position.x / (CUBICLE_WIDTH + CUBICLE_GAP)) | 0;
      return `<g transform="translate(${position.x + CUBICLE_WIDTH / 2} ${position.bus})"><g class="annex__mail annex__mail--c${column}"><rect x="-4" y="-3" width="8" height="6" rx="1"/><path d="M-4 -3l4 3 4-3"/></g></g>`;
    })
    .join('');
}

/** The subagents of one session, in the space under its room (local coordinates start at the room's top-left). */
export function annexHtml(subagents: SubagentInfo[], subagentsById: Map<string, SubagentInfo>): string {
  const positions = cubiclePositions(subagents);
  const isNested = (subagent: SubagentInfo) => Boolean(subagent.parentAgentId && positions.has(subagent.parentAgentId));
  const fromMain = subagents.filter((subagent) => !isNested(subagent));
  const pipes = mainSessionPipesHtml(fromMain, positions) + nestedPipesHtml(subagents.filter(isNested), positions);
  const cubicles = subagents.map((subagent) => cubicleHtml(subagent, positions.get(subagent.agentId)!, subagentsById)).join('');
  return `${pipes}${mailHtml(fromMain, positions)}${cubicles}`;
}
