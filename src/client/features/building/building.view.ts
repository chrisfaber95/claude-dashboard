import type { DashboardState } from '../../../shared/types/index.ts';
import { mountComponent } from '../../app/mount-component.ts';
import { openSubagentTranscript, openTranscript } from '../controls/controls.view.ts';
import { elementById } from '../../shared/dom.ts';
import BuildingScene from './building-scene.vue';
import { setOpenBuilding } from './building-selection.ts';
import { buildingSubtitle } from './building.logic.ts';

const DEFAULT_TINT_CLASS = 'tint-1';

let openProjectName: string | null = null;
let latestState: DashboardState | null = null;
let tintClassOf: (name: string) => string = () => DEFAULT_TINT_CLASS;

function isActivationKey(event: KeyboardEvent): boolean {
  return event.key === 'Enter' || event.key === ' ';
}

function asElement(target: EventTarget | null): Element | null {
  return target instanceof Element ? target : null;
}

/** Title and subtitle of the popup; the drawing itself is the scene component, which follows the store. */
function renderBuilding(): void {
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
  setOpenBuilding({ name, tintClass: tintClassOf(name) });
}

function closeBuilding(): void {
  const name = openProjectName;
  openProjectName = null;
  setOpenBuilding(null);
  elementById('building').hidden = true;
  // Hand keyboard focus back to the card that opened the building.
  if (name) document.querySelector<HTMLElement>(`[data-building="${CSS.escape(name)}"]`)?.focus();
}

/** Open the building popup of a project and focus its close button. */
export function openBuilding(name: string): void {
  openProjectName = name;
  elementById('building').hidden = false;
  renderBuilding();
  elementById('building-close').focus();
}

/** Called on every state push: keeps an open building in step with the live sessions. */
export function updateBuilding(state: DashboardState, tintClass: (name: string) => string): void {
  latestState = state;
  tintClassOf = tintClass;
  renderBuilding();
}

/** A click or Enter on a room opens the session's transcript; on a cubicle, the subagent's. */
function activate(target: Element): boolean {
  const cubicle = target.closest<SVGElement>('[data-sub]');
  const subagentId = cubicle?.dataset.sub;
  if (cubicle && subagentId) {
    openSubagentTranscript(subagentId, cubicle.dataset.name ?? subagentId);
    return true;
  }
  const room = target.closest<SVGElement>('[data-room]');
  const sessionId = room?.dataset.room;
  if (room && sessionId) {
    openTranscript(sessionId, room.dataset.name ?? sessionId);
    return true;
  }
  return false;
}

/** The project card an event came from, if its target is inside one. */
function buildingCardOf(target: EventTarget | null): HTMLElement | null {
  return asElement(target)?.closest<HTMLElement>('[data-building]') ?? null;
}

/** Wire the building popup: mount the scene, close, room/cubicle activation, Escape, and the project cards that open it. */
export function initBuilding(): void {
  mountComponent(BuildingScene, 'building-body');
  elementById('building-close').addEventListener('click', closeBuilding);
  elementById('building').addEventListener('click', (event) => {
    const target = asElement(event.target);
    if (!target) return;
    if (target.id === 'building') closeBuilding();
    else activate(target);
  });
  elementById('building').addEventListener('keydown', (event) => {
    if (!isActivationKey(event)) return;
    const target = asElement(event.target);
    if (target && activate(target)) event.preventDefault();
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
    const name = buildingCardOf(event.target)?.dataset.building;
    if (name) openBuilding(name);
  });
  document.addEventListener('keydown', (event) => {
    if (!isActivationKey(event)) return;
    const card = buildingCardOf(event.target);
    if (!card || card !== event.target) return;
    event.preventDefault();
    if (card.dataset.building) openBuilding(card.dataset.building);
  });
}
