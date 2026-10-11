// Shell: wires the feature views to the state stream. It renders nothing itself.
import type { DashboardState } from '../../shared/types/index.ts';
import AlertsPanel from '../features/alerts/alerts-panel.vue';
import BuildingDialog from '../features/building/building-dialog.vue';
import { bindControlsVisibility } from '../features/controls/controls-visibility.ts';
import TranscriptDrawer from '../features/controls/transcript-drawer.vue';
import ToastStack from '../features/controls/toast-stack.vue';
import CoreStrip from '../features/core/core-strip.vue';
import LimitsPanel from '../features/limits/limits-panel.vue';
import PopupShell from '../features/popups/popup-shell.vue';
import SessionsPanel from '../features/sessions/sessions-panel.vue';
import Tooltip from '../features/tooltip/tooltip.vue';
import { elementById } from '../shared/dom.ts';
import { setProjectColors } from '../shared/project-colors.ts';
import { tickTimes } from '../shared/time.ts';
import { initAppearance } from './appearance.ts';
import { mountComponent } from './mount-component.ts';
import { connectStateStream } from './state-stream.ts';

const TIME_TICK_MS = 10_000;

const renderWarning = elementById('render-warn');

function render(state: DashboardState): void {
  // A server started before the subagent feature doesn't send this field; don't let that break the whole page.
  state.subagents ??= [];
  // Each step runs on its own: one failing section must not freeze the others or later pushes.
  const steps: Array<[string, () => void]> = [
    ['colors', () => setProjectColors(state.projects.map((project) => project.name))],
  ];
  let hasFailed = false;
  for (const [name, run] of steps) {
    try {
      run();
    } catch (error) {
      hasFailed = true;
      console.error(`render step "${name}" failed`, error);
    }
  }
  // Fixed text only; the real error goes to the console. Clears itself on the next clean push.
  renderWarning.hidden = !hasFailed;
}

mountComponent(LimitsPanel, 'limits');
mountComponent(SessionsPanel, 'sessions');
mountComponent(Tooltip, 'tip-root');
mountComponent(PopupShell, 'popup-bar'); // before the building dialog: its Escape handler must see the building still open
bindControlsVisibility();
mountComponent(AlertsPanel, 'alerts');
mountComponent(BuildingDialog, 'building-dialog');
mountComponent(TranscriptDrawer, 'transcript-drawer');
mountComponent(ToastStack, 'toast-root');
mountComponent(CoreStrip, 'core');

// Relative times ("3m ago", uptime, resets in) advance on their own light tick, writing only the text that changed.
setInterval(() => tickTimes(), TIME_TICK_MS);

initAppearance();
connectStateStream(render, () => {
  renderWarning.hidden = false;
});
