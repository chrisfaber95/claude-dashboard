// Shell: wires the feature views to the state stream. It renders nothing itself.
import type { DashboardState } from '../../shared/types/index.ts';
import AlertsPanel from '../features/alerts/alerts-panel.vue';
import ChatPanel from '../features/chat/chat-panel.vue';
import BuildingDialog from '../features/building/building-dialog.vue';
import { bindControlsVisibility } from '../features/controls/controls-visibility.ts';
import RunPanel from '../features/controls/run-panel.vue';
import TranscriptDrawer from '../features/controls/transcript-drawer.vue';
import ToastStack from '../features/controls/toast-stack.vue';
import CoreStrip from '../features/core/core-strip.vue';
import AuditPanel from '../features/audit/audit-panel.vue';
import ApprovalsPanel from '../features/permissions/approvals-panel.vue';
import DevicesPanel from '../features/devices/devices-panel.vue';
import LimitsPanel from '../features/limits/limits-panel.vue';
import MessagesPanel from '../features/messages/messages-panel.vue';
import { initPopups, updatePopups } from '../features/popups/popups.view.ts';
import ProjectsPanel from '../features/projects/projects-panel.vue';
import SummarySetting from '../features/settings/summary-setting.vue';
import SessionsPanel from '../features/sessions/sessions-panel.vue';
import TeamPanel from '../features/team/team-panel.vue';
import Tooltip from '../features/tooltip/tooltip.vue';
import UsagePanel from '../features/usage/usage-panel.vue';
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
    ['popups', () => updatePopups(state)],
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
mountComponent(RunPanel, 'run');
mountComponent(ProjectsPanel, 'projects');
mountComponent(SessionsPanel, 'sessions');
mountComponent(TeamPanel, 'team');
mountComponent(Tooltip, 'tip-root');
mountComponent(UsagePanel, 'usage');
initPopups(() => {}); // before the building dialog: its Escape handler must see the building still open
bindControlsVisibility();
mountComponent(AlertsPanel, 'alerts');
mountComponent(SummarySetting, 'summary-setting');
mountComponent(ChatPanel, 'chat-panel');
mountComponent(DevicesPanel, 'devices');
mountComponent(AuditPanel, 'audit');
mountComponent(ApprovalsPanel, 'approvals');
mountComponent(MessagesPanel, 'comms');
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
