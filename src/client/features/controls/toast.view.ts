const TOAST_SHOWN_MS = 6000;

/** Show a short status message in the corner for a few seconds. Text only: never innerHTML. */
export function showToast(text: string, isError = false): void {
  const toast = document.createElement('div');
  toast.className = `toast${isError ? ' toast--error' : ''}`;
  toast.setAttribute('role', 'status');
  toast.textContent = text;
  document.body.append(toast);
  window.setTimeout(() => toast.remove(), TOAST_SHOWN_MS);
}
