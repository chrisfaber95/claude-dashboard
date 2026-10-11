// Shell: wires the feature views to the state stream. It renders nothing itself.
import type { DashboardState } from '../../shared/types/index.ts';
import { initAlerts, renderAlerts } from '../features/alerts/alerts.view.ts';
import { initSummarySetting } from '../features/settings/settings.view.ts';
import ChatPanel from '../features/chat/chat-panel.vue';
import { initBuilding, updateBuilding } from '../features/building/building.view.ts';
import { initControls, updateControls } from '../features/controls/controls.view.ts';
import CoreStrip from '../features/core/core-strip.vue';
import { initAudit, renderAudit } from '../features/audit/audit.view.ts';
import { initDevices, renderDevices } from '../features/devices/devices.view.ts';
import LimitsPanel from '../features/limits/limits-panel.vue';
import { renderMessages } from '../features/messages/messages.view.ts';
import { initPermissions, renderApprovals, updateApprovals } from '../features/permissions/permissions.view.ts';
import { draws, initPopups, updatePopups } from '../features/popups/popups.view.ts';
import type { PopupId } from '../features/popups/popups.logic.ts';
import ProjectsPanel from '../features/projects/projects-panel.vue';
import { renderSessions } from '../features/sessions/sessions.view.ts';
import TeamPanel from '../features/team/team-panel.vue';
import Tooltip from '../features/tooltip/tooltip.vue';
import { initUsage, renderUsage } from '../features/usage/usage.view.ts';
import { elementById } from '../shared/dom.ts';
import { setProjectColors, projectTint } from '../shared/project-colors.ts';
import { tickTimes } from '../shared/time.ts';
import { initAppearance } from './appearance.ts';
import { mountComponent } from './mount-component.ts';
import { connectStateStream } from './state-stream.ts';

const TIME_TICK_MS = 10_000;

let latestState: DashboardState | null = null;
const renderWarning = elementById('render-warn');

function render(state: DashboardState): void {
  // A server started before the subagent feature doesn't send this field; don't let that break the whole page.
  state.subagents ??= [];
  latestState = state;
  // Each step runs on its own: one failing section must not freeze the others or later pushes.
  const steps: Array<[string, () => void]> = [
    ['colors', () => setProjectColors(state.projects.map((project) => project.name))],
    ['alerts', () => renderAlerts(state)],
    ['devices', () => renderDevices(state)],
    ['audit', () => renderAudit(state)],
    ['approvals', () => updateApprovals(state)],
    ['sessions', () => renderSessions(state)],
    ['messages', () => draws('comms') && renderMessages(state)],
    ['usage', () => draws('usage') && renderUsage(state)],
    ['controls', () => updateControls(state)],
    ['building', () => updateBuilding(state, projectTint)],
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

// Opening a popup draws its section from the latest state first; closed popups are skipped on pushes.
function drawPopup(id: PopupId): void {
  if (!latestState) return;
  if (id === 'comms') renderMessages(latestState);
  else if (id === 'usage') renderUsage(latestState);
  else if (id === 'approvals') renderApprovals();
}

mountComponent(LimitsPanel, 'limits');
mountComponent(ProjectsPanel, 'projects');
mountComponent(TeamPanel, 'team');
mountComponent(Tooltip, 'tip-root');
initUsage(() => latestState);
initPopups(drawPopup); // before initBuilding: its Escape handler must see the building still open
initControls();
initAlerts();
initSummarySetting();
mountComponent(ChatPanel, 'chat-panel');
initDevices();
initAudit();
initPermissions(() => {
  if (!latestState) return;
  renderSessions(latestState);
  renderAlerts(latestState);
});
initBuilding();
mountComponent(CoreStrip, 'core');

// Relative times ("3m ago", uptime, resets in) advance on their own light tick, writing only the text that changed.
setInterval(() => tickTimes(), TIME_TICK_MS);

initAppearance();
connectStateStream(render, () => {
  renderWarning.hidden = false;
});
