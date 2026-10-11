import type { Alert } from '../../../shared/types/index.ts';

const TOAST_MS = 8000;
const MAX_TOASTS = 4;

/** Show a short-lived toast for a new alert; built with `textContent`, the oldest toasts drop past four. */
export function showAlertToast(alertItem: Alert): void {
  const box = document.getElementById('toasts');
  if (!box) return;
  const toast = document.createElement('div');
  toast.className = 'alert-toast';
  const title = document.createElement('strong');
  title.textContent = alertItem.title;
  const detail = document.createElement('span');
  detail.className = 'sub';
  detail.textContent = alertItem.detail;
  toast.append(title, detail);
  box.append(toast);
  while (box.children.length > MAX_TOASTS) box.firstElementChild?.remove();
  setTimeout(() => toast.remove(), TOAST_MS);
}
