import { ref } from 'vue';
import type { Ref } from 'vue';
import type { AnswerProgress } from './permissions.logic.ts';

// Module state, not per component: the same request can be listed in the sessions and the needs-you list,
// and answering it in one must disable the buttons in the other.
const progressById = ref(new Map<string, AnswerProgress>());

/** Answer progress per request id, shared by every permission list. */
export function usePermissionProgress(): Ref<Map<string, AnswerProgress>> {
  return progressById;
}
