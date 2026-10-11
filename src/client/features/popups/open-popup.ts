import { shallowRef } from 'vue';
import type { Ref } from 'vue';
import type { PopupId } from './popups.logic.ts';

const openPopupId = shallowRef<PopupId | null>(null);

/** Record which popup is open (null when none); called by the popup shell on open and close. */
export function setOpenPopup(id: PopupId | null): void {
  openPopupId.value = id;
}

/** The id of the open popup, or null. A panel reads it reactively to compute only while its popup is open. */
export function useOpenPopup(): Readonly<Ref<PopupId | null>> {
  return openPopupId;
}
