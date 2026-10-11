import { watchEffect } from 'vue';
import { useDashboardState } from '../../app/dashboard-state.ts';
import { elementById } from '../../shared/dom.ts';

/** Keep the logout button in step with the latest state push. */
export function bindControlsVisibility(): void {
  try {
    localStorage.removeItem('recentTasks'); // old per-browser history, replaced by the server-side launch history
  } catch {
    // storage unavailable
  }
  const state = useDashboardState();
  watchEffect(() => {
    if (!state.value) return;
    const { features } = state.value;
    elementById('logout').hidden = !features.lan;
  });
}
