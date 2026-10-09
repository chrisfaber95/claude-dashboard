import { POPUPS, drawsSection, backdropCloses, escapeClosesPopup, stillOpen, toggled, visiblePopups } from './popups-logic.ts';
import type { PopupId } from './popups-logic.ts';
import { $ } from './util.ts';

// The popup sections stay in the DOM and keep rendering on every state push; opening one only unhides its wrapper.
// That is why an open popup keeps its typed input, focus and selection while it updates.

let current: PopupId | null = null;
let opener: HTMLElement | null = null;
let onOpen: (id: PopupId) => void = () => {};

/** Whether the section `id` should be rendered on this push. */
export const draws = (id: string): boolean => drawsSection(id, current);

const wrap = (id: PopupId) => $(`popup-${id}`);
const button = (id: PopupId) => document.querySelector<HTMLButtonElement>(`[data-popup="${id}"]`)!;
const sectionHidden = (id: PopupId) => $(id === 'audit' ? 'audit' : id).hidden;

function show(id: PopupId | null) {
  for (const p of POPUPS) wrap(p.id).hidden = p.id !== id;
  $('popups').hidden = id === null;
  for (const p of POPUPS) button(p.id).setAttribute('aria-expanded', String(p.id === id));
  current = id;
}

function open(id: PopupId, from: HTMLElement) {
  opener = from;
  show(id);
  if (id === 'audit') $<HTMLDetailsElement>('audit').open = true; // its toggle handler loads the list
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
  for (const p of POPUPS) button(p.id).hidden = !visible.includes(p.id);
  if (stillOpen(current, visible) === null && current) close();
}

export function initPopups(render: (id: PopupId) => void): void {
  onOpen = render;
  const bar = $('popup-bar');
  for (const p of POPUPS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn';
    b.dataset.popup = p.id;
    b.textContent = p.label;
    b.setAttribute('aria-haspopup', 'dialog');
    b.setAttribute('aria-expanded', 'false');
    bar.append(b);
  }
  bar.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-popup]');
    if (!b) return;
    const next = toggled(current, b.dataset.popup as PopupId);
    if (next) open(next, b);
    else close();
  });
  $('popups').addEventListener('click', (e) => {
    if (backdropCloses(e.target, $('popups')) || (e.target as Element).closest('[data-popup-close]')) close();
  });
  // Capture phase and registered before the building dialog and drawer: they are still open when this runs,
  // so Esc closes them first and the popup only on the next press.
  document.addEventListener(
    'keydown',
    (e) => {
      if (escapeClosesPopup(e.key, current, !$('building').hidden || !$('drawer').hidden)) close();
    },
    true,
  );
  updatePopups();
}
