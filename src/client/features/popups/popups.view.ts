import { POPUPS, drawsSection, openPopup, backdropCloses, escapeClosesPopup, stillOpen, toggled, visiblePopups } from './popups.logic.ts';
import type { PopupId } from './popups.logic.ts';
import { elementById } from '../../shared/dom.ts';

// The popup sections stay in the DOM; only the open one is rendered on a state push, and opening one renders it from
// the latest state at once. An open popup keeps its typed input, focus and selection while it updates.

let current: PopupId | null = null;
let opener: HTMLElement | null = null;
let onOpen: (id: PopupId) => void = () => {};

/** Whether the section `id` should be rendered on this push. */
export const draws = (id: string): boolean => drawsSection(id, current);

const wrap = (id: PopupId) => elementById(`popup-${id}`);
const button = (id: PopupId) => document.querySelector<HTMLButtonElement>(`[data-popup="${id}"]`)!;
const sectionHidden = (id: PopupId) => elementById(id === 'audit' ? 'audit' : id).hidden;

function show(id: PopupId | null) {
  for (const popup of POPUPS) wrap(popup.id).hidden = popup.id !== id;
  elementById('popups').hidden = id === null;
  for (const popup of POPUPS) button(popup.id).setAttribute('aria-expanded', String(popup.id === id));
  current = id;
}

function open(id: PopupId, from: HTMLElement) {
  opener = from;
  openPopup(id, show, onOpen);
  if (id === 'audit') elementById<HTMLDetailsElement>('audit').open = true; // its toggle handler loads the list
  wrap(id).querySelector<HTMLElement>('[data-popup-close]')?.focus();
}

function close() {
  if (!current) return;
  show(null);
  // Hand keyboard focus back to the button that opened it.
  if (opener && !opener.hidden) opener.focus();
  opener = null;
}

/** Called on every state push: shows only the buttons whose section exists, and closes a popup whose section went away. */
export function updatePopups(): void {
  const visible = visiblePopups(sectionHidden);
  for (const popup of POPUPS) button(popup.id).hidden = !visible.includes(popup.id);
  if (stillOpen(current, visible) === null && current) close();
}

/** Create the popup buttons and wire open, close, backdrop and Esc handling. */
export function initPopups(render: (id: PopupId) => void): void {
  onOpen = render;
  const bar = elementById('popup-bar');
  for (const popup of POPUPS) {
    const popupButton = document.createElement('button');
    popupButton.type = 'button';
    popupButton.className = 'btn';
    popupButton.dataset.popup = popup.id;
    popupButton.textContent = popup.label;
    popupButton.setAttribute('aria-haspopup', 'dialog');
    popupButton.setAttribute('aria-expanded', 'false');
    bar.append(popupButton);
  }
  bar.addEventListener('click', (event) => {
    const popupButton = (event.target as Element).closest<HTMLButtonElement>('[data-popup]');
    if (!popupButton) return;
    const next = toggled(current, popupButton.dataset.popup as PopupId);
    if (next) open(next, popupButton);
    else close();
  });
  elementById('popups').addEventListener('click', (event) => {
    if (backdropCloses(event.target, elementById('popups')) || (event.target as Element).closest('[data-popup-close]')) close();
  });
  // Capture phase and registered before the building dialog and drawer: they are still open when this runs,
  // so Esc closes them first and the popup only on the next press.
  document.addEventListener(
    'keydown',
    (event) => {
      if (escapeClosesPopup(event.key, current, !elementById('building').hidden || !elementById('drawer').hidden)) close();
    },
    true,
  );
  updatePopups();
}
