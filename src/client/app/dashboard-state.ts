import { computed, shallowRef } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import { isRecord } from '../../shared/guards.ts';
import type { DashboardState } from '../../shared/types/index.ts';

// The whole state is replaced on every push (every 2 s), so a shallow ref is enough: no deep proxies.
const currentState = shallowRef<DashboardState | null>(null);

const ARRAY_FIELDS = ['projects', 'sessions', 'subagents', 'messages', 'recentSessions', 'permissions'] as const;
const OBJECT_FIELDS = ['usage', 'limits', 'features', 'alerts'] as const;

/** Check the top-level shape of a parsed `/api/events` push; nested fields are trusted from the server. */
export function isDashboardState(value: unknown): value is DashboardState {
  if (!isRecord(value)) return false;
  if (typeof value.generatedAtMs !== 'number') return false;
  if (!ARRAY_FIELDS.every((field) => Array.isArray(value[field]))) return false;
  if (!OBJECT_FIELDS.every((field) => isRecord(value[field]))) return false;
  return 'team' in value;
}

/** Replace the stored state; called for every push. */
export function setDashboardState(state: DashboardState): void {
  currentState.value = state;
}

/** The latest pushed state, or null before the first push. Components read it reactively. */
export function useDashboardState(): Readonly<Ref<DashboardState | null>> {
  return currentState;
}

/** A derived value that recomputes when a new state arrives; `select` gets the state once one exists. */
export function selectDashboardState<T>(select: (state: DashboardState) => T): ComputedRef<T | null> {
  return computed(() => (currentState.value ? select(currentState.value) : null));
}
