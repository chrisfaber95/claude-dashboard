import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { setDashboardState } from '../../../../src/client/app/dashboard-state.ts';
import { bindControlsVisibility } from '../../../../src/client/features/controls/controls-visibility.ts';
import type { DashboardState } from '../../../../src/shared/types/index.ts';

function makeState(features: { lan: boolean; commands: boolean }): DashboardState {
  return {
    generatedAtMs: 1,
    projects: [],
    sessions: [],
    subagents: [],
    messages: [],
    usage: { days: [], totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, byModel: {} },
    limits: { source: 'none', fetchedAtMs: null, error: null, windows: [], hits: [] },
    recentSessions: [],
    features: { ...features, permissionModes: [], manageDevices: false },
    team: null,
    alerts: { items: [], threshold: 80 },
    permissions: [],
  };
}

describe('bindControlsVisibility', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<section id="run" hidden></section><form id="logout" hidden></form>' +
      '<select id="summary-mode"><option value="recap">recap</option></select><span id="summary-note" hidden></span>';
  });

  it('shows the run section and logout button only when the state turns the features on', async () => {
    bindControlsVisibility();
    setDashboardState(makeState({ lan: true, commands: true }));
    await flushPromises();
    expect(document.getElementById('run')?.hidden).toBe(false);
    expect(document.getElementById('logout')?.hidden).toBe(false);

    setDashboardState(makeState({ lan: false, commands: false }));
    await flushPromises();
    expect(document.getElementById('run')?.hidden).toBe(true);
    expect(document.getElementById('logout')?.hidden).toBe(true);
  });
});
