import { shallowRef } from 'vue';
import type { Ref } from 'vue';

const TOAST_SHOWN_MS = 6000;

/** One status message in the corner. */
export interface Toast {
  id: number;
  text: string;
  isError: boolean;
}

const toasts = shallowRef<Toast[]>([]);
let nextToastId = 1;

/** The toasts on screen. The toast stack component reads it reactively. */
export function useToasts(): Readonly<Ref<Toast[]>> {
  return toasts;
}

/** Show a short status message in the corner for a few seconds. */
export function showToast(text: string, isError = false): void {
  const toast: Toast = { id: nextToastId++, text, isError };
  toasts.value = [...toasts.value, toast];
  window.setTimeout(() => {
    toasts.value = toasts.value.filter((shown) => shown.id !== toast.id);
  }, TOAST_SHOWN_MS);
}
