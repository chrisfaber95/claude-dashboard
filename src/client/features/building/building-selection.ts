import { shallowRef } from 'vue';
import type { Ref } from 'vue';

/** The project whose building is open, and the tint class of its sign. */
export interface OpenBuilding {
  name: string;
  tintClass: string;
}

const openBuilding = shallowRef<OpenBuilding | null>(null);

/** The open building, or null while the popup is closed. The scene component reads it reactively. */
export function useOpenBuilding(): Readonly<Ref<OpenBuilding | null>> {
  return openBuilding;
}

/** Set by the popup shell when a building opens, closes or its sign colour changes. */
export function setOpenBuilding(next: OpenBuilding | null): void {
  const current = openBuilding.value;
  if (current === next) return;
  if (current && next && current.name === next.name && current.tintClass === next.tintClass) return;
  openBuilding.value = next;
}
