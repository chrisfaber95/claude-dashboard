import type { DashboardState, SessionInfo, SubagentInfo } from '../../../shared/types/index.ts';
import { openSubagentTranscript, openTranscript } from '../controls/controls.view.ts';
import { elementById } from '../../shared/dom.ts';
import { sceneHtml } from './building-scene.view.ts';
import { buildingRedrawKey, buildingSubtitle, cubicleLabel, roomTooltip, sessionStatLine, subagentTooltip } from './building.logic.ts';

const DEFAULT_TINT_CLASS = 'tint-1';

let openProjectName: string | null = null;
let latestState: DashboardState | null = null;
let tintClassOf: (name: string) => string = () => DEFAULT_TINT_CLASS;
let drawnKey = '';

function isActivationKey(event: KeyboardEvent): boolean {
  return event.key === 'Enter' || event.key === ' ';
}

/** Only the changing text and tooltips, so the animations of an unchanged picture keep running. */
function refreshChangedText(body: HTMLElement, sessions: SessionInfo[], subagents: SubagentInfo[]): void {
  const subagentsById = new Map(subagents.map((subagent) => [subagent.agentId, subagent]));
  for (const session of sessions) {
    const id = CSS.escape(session.sessionId);
    const stat = body.querySelector(`[data-stat="${id}"]`);
    if (stat) stat.textContent = sessionStatLine(session);
    body.querySelector(`[data-room="${id}"]`)?.setAttribute('data-tip', roomTooltip(session));
  }
  for (const subagent of subagents) {
    const id = CSS.escape(subagent.agentId);
    const activity = body.querySelector(`[data-act="${id}"]`);
    if (activity) activity.textContent = cubicleLabel(subagent);
    body.querySelector(`[data-sub="${id}"]`)?.setAttribute('data-tip', subagentTooltip(subagent, subagentsById));
  }
}

function renderBuilding(shouldForceRedraw: boolean): void {
  if (!openProjectName || !latestState) return;
  const name = openProjectName;
  const project = latestState.projects.find((candidate) => candidate.name === name);
  if (!project) {
    closeBuilding();
    return;
  }
  const sessions = latestState.sessions.filter((session) => session.project === name).sort((a, b) => a.startedAtMs - b.startedAtMs);
  const sessionIds = new Set(sessions.map((session) => session.sessionId));
  const subagents = latestState.subagents.filter((subagent) => sessionIds.has(subagent.sessionId));

  elementById('building-title').textContent = name;
  elementById('building-sub').textContent = buildingSubtitle(project, sessions, subagents);

  // Re-draw only when something visible changed, so the animations aren't restarted every push.
  const key = buildingRedrawKey(name, tintClassOf(name), sessions, subagents);
  const body = elementById('building-body');
  if (shouldForceRedraw || key !== drawnKey) {
    body.innerHTML = sceneHtml(name, sessions, subagents, tintClassOf(name));
    drawnKey = key;
    return;
  }
  refreshChangedText(body, sessions, subagents);
}

function closeBuilding(): void {
  const name = openProjectName;
  openProjectName = null;
  drawnKey = '';
  elementById('building').hidden = true;
  // Hand keyboard focus back to the card that opened the building.
  if (name) document.querySelector<HTMLElement>(`[data-building="${CSS.escape(name)}"]`)?.focus();
}

/** Open the building popup of a project and focus its close button. */
export function openBuilding(name: string): void {
  openProjectName = name;
  elementById('building').hidden = false;
  renderBuilding(true);
  elementById('building-close').focus();
}

/** Called on every state push: keeps an open building in step with the live sessions. */
export function updateBuilding(state: DashboardState, tintClass: (name: string) => string): void {
  latestState = state;
  tintClassOf = tintClass;
  renderBuilding(false);
}

/** A click or Enter on a room opens the session's transcript; on a cubicle, the subagent's. */
function activate(target: Element): boolean {
  const cubicle = target.closest<SVGElement>('[data-sub]');
  if (cubicle) {
    openSubagentTranscript(cubicle.dataset.sub!, cubicle.dataset.name ?? cubicle.dataset.sub!);
    return true;
  }
  const room = target.closest<SVGElement>('[data-room]');
  if (room) {
    openTranscript(room.dataset.room!, room.dataset.name ?? room.dataset.room!);
    return true;
  }
  return false;
}

/** Wire the building popup: close, room/cubicle activation, Escape, and the project cards that open it. */
export function initBuilding(): void {
  elementById('building-close').addEventListener('click', closeBuilding);
  elementById('building').addEventListener('click', (event) => {
    const target = event.target as Element;
    if (target.id === 'building') closeBuilding();
    else activate(target);
  });
  elementById('building').addEventListener('keydown', (event) => {
    if (!isActivationKey(event)) return;
    if (activate(event.target as Element)) event.preventDefault();
  });
  // Capture phase: runs before the transcript drawer's handler, so Escape closes the drawer first and the building second.
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && openProjectName && elementById('drawer').hidden) closeBuilding();
    },
    true,
  );
  document.addEventListener('click', (event) => {
    const card = (event.target as Element).closest<HTMLElement>('[data-building]');
    if (card) openBuilding(card.dataset.building!);
  });
  document.addEventListener('keydown', (event) => {
    if (!isActivationKey(event)) return;
    const card = (event.target as Element).closest<HTMLElement>('[data-building]');
    if (!card || card !== event.target) return;
    event.preventDefault();
    openBuilding(card.dataset.building!);
  });
}
