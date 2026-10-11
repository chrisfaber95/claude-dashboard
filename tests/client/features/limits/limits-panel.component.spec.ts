import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { describe, expect, it } from 'vitest';
import { setDashboardState } from '../../../../src/client/app/dashboard-state.ts';
import LimitsPanel from '../../../../src/client/features/limits/limits-panel.vue';
import type { DashboardState, LimitsInfo } from '../../../../src/shared/types/index.ts';

function makeState(limits: LimitsInfo): DashboardState {
  return {
    generatedAtMs: 1,
    projects: [],
    sessions: [],
    subagents: [],
    messages: [],
    usage: { days: [], totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, byModel: {} },
    limits,
    recentSessions: [],
    features: { lan: false, commands: false, permissionModes: [], manageDevices: false },
    team: null,
    alerts: { items: [], threshold: 80 },
    permissions: [],
  };
}

const liveLimits: LimitsInfo = {
  source: 'live',
  fetchedAtMs: Date.now(),
  error: null,
  windows: [
    { key: 'five_hour', label: '5-hour', utilization: 42.4, resetsAtMs: Date.now() + 3_600_000 },
    { key: 'seven_day', label: '7-day', utilization: 91, resetsAtMs: null },
  ],
  hits: [{ tsMs: Date.now() - 60_000, type: 'five_hour', resetsAtMs: null, project: '<b>demo</b>' }],
};

describe('LimitsPanel', () => {
  it('renders the gauges, top badge, source and last hits of a state', () => {
    setDashboardState(makeState(liveLimits));
    const wrapper = mount(LimitsPanel);

    expect(wrapper.get('h2').text()).toContain('Subscription limits');
    expect(wrapper.get('.limits__top').text()).toBe('91%');
    expect(wrapper.get('.limits__top').classes()).toContain('is-crit');
    const gauges = wrapper.findAll('.gauge');
    expect(gauges.map((gauge) => gauge.attributes('data-key'))).toEqual(['5-hour', '7-day']);
    expect(gauges[0]?.get('.gauge__value').text()).toBe('42%');
    expect(gauges[0]?.get('.gauge__track').attributes('aria-valuenow')).toBe('42');
    expect(gauges[0]?.get('.gauge__fill').attributes('style')).toContain('width: 42.4%');
    expect(wrapper.text()).toContain('live · updated');
    expect(wrapper.text()).toContain('Last limit hits: five_hour');
  });

  it('escapes project names and shows the empty message without windows', () => {
    setDashboardState(makeState(liveLimits));
    const wrapper = mount(LimitsPanel);
    expect(wrapper.find('.sub b').exists()).toBe(false);
    expect(wrapper.text()).toContain('(<b>demo</b>)');

    setDashboardState(makeState({ source: 'none', fetchedAtMs: null, error: 'offline', windows: [], hits: [] }));
    return nextTick().then(() => {
      expect(wrapper.find('.limits__top').exists()).toBe(false);
      expect(wrapper.get('.empty').text()).toBe('No limit data available.');
      expect(wrapper.text()).toContain('no limit data · offline');
    });
  });

  it('updates on the next push without replacing the gauge elements', async () => {
    setDashboardState(makeState(liveLimits));
    const wrapper = mount(LimitsPanel);
    const gaugeBefore = wrapper.get('.gauge').element;

    const [firstWindow, secondWindow] = liveLimits.windows;
    if (!firstWindow || !secondWindow) throw new Error('fixture needs two windows');
    setDashboardState(makeState({ ...liveLimits, windows: [{ ...firstWindow, utilization: 80 }, secondWindow] }));
    await nextTick();

    expect(wrapper.get('.gauge__value').text()).toBe('80%');
    expect(wrapper.get('.gauge').element).toBe(gaugeBefore);
  });
});
