import type { Alert, DashboardState } from '../shared/types.ts';
import { badgeCount, createAlertTracker } from './alerts-logic.ts';
import { $, api, esc, until } from './util.ts';

const tracker = createAlertTracker();
let listHtml = '';
const TOAST_MS = 8000;
const MAX_TOASTS = 4;

function row(a: Alert): string {
  const reset = a.kind === 'usage' ? `<div class="sub">${esc(until(a.resetsAtMs))}</div>` : '';
  return `<li class="alerts__item alerts__item--${esc(a.kind)}">
    <div class="alerts__text"><div class="alerts__title">${esc(a.title)}</div><div class="sub">${esc(a.detail)}</div>${reset}</div>
    <button class="btn btn--sm" type="button" data-dismiss="${esc(a.id)}" aria-label="${esc(`Dismiss: ${a.title}`)}">Dismiss</button></li>`;
}

function toast(a: Alert): void {
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = 'alert-toast';
  const t = document.createElement('strong');
  t.textContent = a.title;
  const d = document.createElement('span');
  d.className = 'sub';
  d.textContent = a.detail;
  el.append(t, d);
  box.append(el);
  while (box.children.length > MAX_TOASTS) box.firstElementChild?.remove();
  setTimeout(() => el.remove(), TOAST_MS);
}

/** Header badge, panel list, threshold input and toasts for the alerts in the pushed state. */
export function renderAlerts(s: DashboardState): void {
  const info = s.alerts ?? { items: [], threshold: 80 };
  const seen = new Set<string>();
  const items = info.items.filter((a) => !seen.has(a.id) && seen.add(a.id));

  const n = badgeCount(items);
  const badge = $('alert-badge');
  badge.hidden = n === 0;
  badge.textContent = n ? String(n) : '';

  const html = items.length ? items.map(row).join('') : '<li class="empty">Nothing needs attention.</li>';
  if (html !== listHtml) {
    listHtml = html;
    $('alerts-list').innerHTML = html;
  }

  // Form: never overwrite what the user is typing.
  const input = $<HTMLInputElement>('alerts-threshold');
  if (document.activeElement !== input) input.value = String(info.threshold);

  for (const a of tracker.update(items)) toast(a);
}

export function initAlerts(): void {
  const status = $('alerts-status');
  $('alerts-list').addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-dismiss]');
    if (!b) return;
    b.disabled = true;
    status.textContent = '';
    api('/api/alerts/dismiss', { id: b.dataset['dismiss'] }).catch(() => {
      b.disabled = false;
      status.textContent = 'Could not dismiss the alert.';
    });
  });
  $('alerts-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = Number($<HTMLInputElement>('alerts-threshold').value);
    if (!Number.isInteger(v) || v < 1 || v > 100) {
      status.textContent = 'Enter a whole number from 1 to 100.';
      return;
    }
    status.textContent = '';
    api('/api/settings/alerts', { threshold: v }).then(
      () => (status.textContent = 'Saved.'),
      () => (status.textContent = 'Could not save the threshold.'),
    );
  });
}
