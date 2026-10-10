// Live "core" strip for the Co-pilot and Root skins. The markup is built once; updates only toggle a class and
// change text when it differs, so the 2 s state pushes never restart the CSS animations.
import type { DashboardState } from '../../../shared/types/index.ts';
import { CORE_LABEL, coreHeadlineParts, coreSummary } from './mood.logic.ts';
import type { CoreMood } from './mood.logic.ts';
import { elementById } from '../../shared/dom.ts';

const BARS = 41;
const RIPPLE_COUNT = 3;
const THINK_DOT_COUNT = 3;

let root: HTMLElement | null = null;
let label: HTMLElement | null = null;
let headline: HTMLElement | null = null;
let lead: HTMLElement | null = null;
let accent: HTMLElement | null = null;
let lastMood: CoreMood | null = null;
let lastLabel = '';
let lastHeadline = '';

function createElement(tag: string, className: string, text?: string): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

/** Build the core strip markup once; later calls are no-ops. */
export function initCore(): void {
  root = elementById('core');
  if (root.childElementCount > 0) return;

  const title = createElement('h2', 'sr-only', 'Assistant status');
  title.id = 'h-core';

  // One live region around pill and headline, so the headline is announced too.
  const live = createElement('div', 'core__live');
  live.setAttribute('role', 'status');
  const pill = createElement('div', 'core__pill');
  pill.append(createElement('span', 'core__dot'));
  label = createElement('span', 'core__label');
  pill.append(label);

  headline = createElement('p', 'core__headline');
  lead = createElement('span', 'core__lead');
  accent = createElement('span', 'core__accent'); // last clause; the Root skin colours it
  headline.append(lead, accent);
  live.append(pill, headline);

  const equalizer = createElement('div', 'core__eq');
  equalizer.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < BARS; i++) equalizer.append(createElement('span', 'core__bar'));

  const scan = createElement('div', 'core__scan');
  scan.setAttribute('aria-hidden', 'true');
  scan.append(createElement('div', 'core__sweep'), createElement('div', 'core__segments'));

  const badge = createElement('div', 'core__badge');
  badge.setAttribute('aria-hidden', 'true');
  badge.append(createElement('span', 'core__badge-mic'));

  // Root skin parts (hidden in Co-pilot). root-scene.ts adds the seed artwork, so other skins never load it.
  const seedwrap = createElement('div', 'core__seedwrap');
  seedwrap.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < RIPPLE_COUNT; i++) seedwrap.append(createElement('span', 'core__ripple'));
  seedwrap.append(createElement('div', 'core__seed'));

  const think = createElement('div', 'core__think');
  think.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < THINK_DOT_COUNT; i++) think.append(createElement('span', 'core__think-dot'));

  root.append(title, live, equalizer, scan, badge, seedwrap, think);
}

/** Toggle the mood class and change label and headline text only when they differ. */
export function updateCore(state: DashboardState): void {
  if (!root || !label || !headline || !lead || !accent) return;
  const summary = coreSummary(state);
  if (summary.mood !== lastMood) {
    root.classList.remove('core--standby', 'core--working', 'core--waiting');
    root.classList.add(`core--${summary.mood}`);
    lastMood = summary.mood;
    document.documentElement.setAttribute('data-mood', summary.mood); // read by the Root scene
  }
  const labelText = CORE_LABEL[summary.mood];
  if (labelText !== lastLabel) {
    label.textContent = labelText;
    lastLabel = labelText;
  }
  const parts = coreHeadlineParts(summary);
  const key = `${parts.lead}\u0000${parts.accent}`;
  if (key !== lastHeadline) {
    lead.textContent = parts.lead;
    accent.textContent = parts.accent;
    lastHeadline = key;
  }
}
