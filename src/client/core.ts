// Live "core" strip for the Co-pilot skin. The markup is built once; updates only toggle a class and
// change text when it differs, so the 2 s state pushes never restart the CSS animations.
import type { DashboardState } from '../shared/types.ts';
import { CORE_LABEL, coreHeadline, coreSummary } from './mood.ts';
import type { CoreMood } from './mood.ts';
import { $ } from './util.ts';

const BARS = 41;

let root: HTMLElement | null = null;
let label: HTMLElement | null = null;
let headline: HTMLElement | null = null;
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

  root.append(title, live, eq, scan, badge);
}

export function updateCore(s: DashboardState): void {
  if (!root || !label || !headline) return;
  const c = coreSummary(s);
  if (c.mood !== lastMood) {
    root.classList.remove('core--standby', 'core--working', 'core--waiting');
    root.classList.add(`core--${c.mood}`);
    lastMood = c.mood;
  }
  const l = CORE_LABEL[c.mood];
  if (l !== lastLabel) {
    label.textContent = l;
    lastLabel = l;
  }
  const h = coreHeadline(c);
  if (h !== lastHeadline) {
    headline.textContent = h;
    lastHeadline = h;
  }
}
