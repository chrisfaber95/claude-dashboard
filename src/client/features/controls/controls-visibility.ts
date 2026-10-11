import { watchEffect } from 'vue';
import { useDashboardState } from '../../app/dashboard-state.ts';
import { elementById } from '../../shared/dom.ts';
import { updateSummaryNote } from '../settings/settings.view.ts';

/** Keep the run section, the logout button and the summary note in step with the latest state push. */
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
    updateSummaryNote(features.commands);
    elementById('run').hidden = !features.commands;
    elementById('logout').hidden = !features.lan;
  });
}
