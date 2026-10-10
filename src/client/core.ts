// Live "core" strip for the Co-pilot and Root skins. The markup is built once; updates only toggle a class and
// change text when it differs, so the 2 s state pushes never restart the CSS animations.
import type { DashboardState } from '../shared/types/index.ts';
import { CORE_LABEL, coreHeadlineParts, coreSummary } from './mood.ts';
import type { CoreMood } from './mood.ts';
import { $ } from './util.ts';

const BARS = 41;

let root: HTMLElement | null = null;
let label: HTMLElement | null = null;
let headline: HTMLElement | null = null;
let lead: HTMLElement | null = null;
let accent: HTMLElement | null = null;
let lastMood: CoreMood | null = null;
let lastLabel = '';
let lastHeadline = '';

function el(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function initCore(): void {
  root = $('core');
  if (root.childElementCount > 0) return;

  const title = el('h2', 'sr-only', 'Assistant status');
  title.id = 'h-core';

  // One live region around pill and headline, so the headline is announced too.
  const live = el('div', 'core__live');
  live.setAttribute('role', 'status');
  const pill = el('div', 'core__pill');
  pill.append(el('span', 'core__dot'));
  label = el('span', 'core__label');
  pill.append(label);

  headline = el('p', 'core__headline');
  lead = el('span', 'core__lead');
  accent = el('span', 'core__accent'); // last clause; the Root skin colours it
  headline.append(lead, accent);
  live.append(pill, headline);

  const eq = el('div', 'core__eq');
  eq.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < BARS; i++) eq.append(el('span', 'core__bar'));

  const scan = el('div', 'core__scan');
  scan.setAttribute('aria-hidden', 'true');
  scan.append(el('div', 'core__sweep'), el('div', 'core__segments'));

  const badge = el('div', 'core__badge');
  badge.setAttribute('aria-hidden', 'true');
  badge.append(el('span', 'core__badge-mic'));

  // Root skin parts (hidden in Co-pilot). root-scene.ts adds the seed artwork, so other skins never load it.
  const seedwrap = el('div', 'core__seedwrap');
  seedwrap.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i++) seedwrap.append(el('span', 'core__ripple'));
  seedwrap.append(el('div', 'core__seed'));

  const think = el('div', 'core__think');
  think.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i++) think.append(el('span', 'core__think-dot'));

  root.append(title, live, eq, scan, badge, seedwrap, think);
}

export function updateCore(s: DashboardState): void {
  if (!root || !label || !headline || !lead || !accent) return;
  const c = coreSummary(s);
  if (c.mood !== lastMood) {
    root.classList.remove('core--standby', 'core--working', 'core--waiting');
    root.classList.add(`core--${c.mood}`);
    lastMood = c.mood;
    document.documentElement.setAttribute('data-mood', c.mood); // read by the Root scene
  }
  const l = CORE_LABEL[c.mood];
  if (l !== lastLabel) {
    label.textContent = l;
    lastLabel = l;
  }
  const p = coreHeadlineParts(c);
  const key = `${p.lead}\u0000${p.accent}`;
  if (key !== lastHeadline) {
    lead.textContent = p.lead;
    accent.textContent = p.accent;
    lastHeadline = key;
  }
}
