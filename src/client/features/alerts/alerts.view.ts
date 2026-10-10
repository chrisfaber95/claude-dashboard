import type { Alert, DashboardState } from '../../../shared/types/index.ts';
import { badgeCount, createAlertTracker } from './alerts.logic.ts';
import { patchHtml } from '../../app/patch.ts';
import { elementById } from '../../shared/dom.ts';
import { api } from '../../shared/api.ts';
import { esc } from '../../shared/escape.ts';
import { timeSpan } from '../../shared/time.ts';

const tracker = createAlertTracker();
const TOAST_MS = 8000;
const MAX_TOASTS = 4;
const MIN_THRESHOLD = 1;
const MAX_THRESHOLD = 100;

function row(alertItem: Alert): string {
  const reset = alertItem.kind === 'usage' ? `<div class="sub">${timeSpan('until', alertItem.resetsAtMs)}</div>` : '';
  return `<li class="alerts__item alerts__item--${esc(alertItem.kind)}" data-key="${esc(alertItem.id)}">
    <div class="alerts__text"><div class="alerts__title">${esc(alertItem.title)}</div><div class="sub">${esc(alertItem.detail)}</div>${reset}</div>
    <button class="btn btn--sm" type="button" data-dismiss="${esc(alertItem.id)}" aria-label="${esc(`Dismiss: ${alertItem.title}`)}">Dismiss</button></li>`;
}

function toast(alertItem: Alert): void {
  const box = elementById('toasts');
  const element = document.createElement('div');
  element.className = 'alert-toast';
  const title = document.createElement('strong');
  title.textContent = alertItem.title;
  const detail = document.createElement('span');
  detail.className = 'sub';
  detail.textContent = alertItem.detail;
  element.append(title, detail);
  box.append(element);
  while (box.children.length > MAX_TOASTS) box.firstElementChild?.remove();
  setTimeout(() => element.remove(), TOAST_MS);
}

/** Header badge, panel list, threshold input and toasts for the alerts in the pushed state. */
export function renderAlerts(state: DashboardState): void {
  const info = state.alerts ?? { items: [], threshold: 80 };
  const seen = new Set<string>();
  const items = info.items.filter((item) => !seen.has(item.id) && seen.add(item.id));

  const badgeTotal = badgeCount(items);
  const badge = elementById('alert-badge');
  badge.hidden = badgeTotal === 0;
  badge.textContent = badgeTotal ? String(badgeTotal) : '';

  elementById('alerts').classList.toggle('has-alerts', items.length > 0);
  const count = elementById('alerts-count');
  count.hidden = items.length === 0;
  count.textContent = items.length ? String(items.length) : '';

  const html = items.length ? items.map(row).join('') : '<li class="empty">Nothing needs attention.</li>';
  patchHtml(elementById('alerts-list'), html);

  // Form: never overwrite what the user is typing.
  const input = elementById<HTMLInputElement>('alerts-threshold');
  if (document.activeElement !== input) input.value = String(info.threshold);

  for (const item of tracker.update(items)) toast(item);
}

/** Wire the dismiss buttons and the threshold form. */
export function initAlerts(): void {
  const status = elementById('alerts-status');
  elementById('alerts-list').addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-dismiss]');
    if (!button) return;
    button.disabled = true;
    status.textContent = '';
    api('/api/alerts/dismiss', { id: button.dataset['dismiss'] }).catch(() => {
      button.disabled = false;
      status.textContent = 'Could not dismiss the alert.';
    });
  });
  elementById('alerts-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const threshold = Number(elementById<HTMLInputElement>('alerts-threshold').value);
    if (!Number.isInteger(threshold) || threshold < MIN_THRESHOLD || threshold > MAX_THRESHOLD) {
      status.textContent = 'Enter a whole number from 1 to 100.';
      return;
    }
    status.textContent = '';
    api('/api/settings/alerts', { threshold }).then(
      () => (status.textContent = 'Saved.'),
      () => (status.textContent = 'Could not save the threshold.'),
    );
  });
}
