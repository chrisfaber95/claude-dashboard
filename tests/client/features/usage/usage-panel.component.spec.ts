import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';
import { setDashboardState } from '../../../../src/client/app/dashboard-state.ts';
import { setOpenPopup } from '../../../../src/client/features/popups/open-popup.ts';
import UsagePanel from '../../../../src/client/features/usage/usage-panel.vue';
import { setProjectColors } from '../../../../src/client/shared/project-colors.ts';
import type { DashboardState, UsageDay } from '../../../../src/shared/types/index.ts';

function makeDay(day: string, byProject: Record<string, number>): UsageDay {
  const total = Object.values(byProject).reduce((sum, tokens) => sum + tokens, 0);
  return { day, byProject, byModel: {}, tokens: { input: total, output: 0, cacheRead: 0, cacheWrite: 0 } };
}

function makeState(days: UsageDay[]): DashboardState {
  return {
    generatedAtMs: 1,
    projects: [],
    sessions: [],
    subagents: [],
    messages: [],
    usage: {
      days,
      totals: { input: 3_000, output: 1_500_000, cacheRead: 0, cacheWrite: 0 },
      byModel: { 'model-small': 10, 'model-big': 2_000 },
    },
    limits: { source: 'none', fetchedAtMs: null, error: null, windows: [], hits: [] },
    recentSessions: [],
    features: { lan: false, commands: true, permissionModes: [], manageDevices: false },
    team: null,
    alerts: { items: [], threshold: 80 },
    permissions: [],
  };
}

function withProjects(state: DashboardState, names: string[]): DashboardState {
  const template = { path: '', branch: null, isWorktree: false, lastActiveMs: 0, liveSessions: 0, trusted: true, tokensToday: 0, tokens7d: 0, tokensTotal: 0 };
  return { ...state, projects: names.map((name) => ({ ...template, name })) };
}

const DAYS = [makeDay('2026-10-09', { alpha: 100, beta: 300 }), makeDay('2026-10-10', { alpha: 500 })];

describe('UsagePanel', () => {
  afterEach(() => setOpenPopup(null));

  it('draws nothing but the heading while the popup is closed, and the chart as soon as it opens', async () => {
    setProjectColors(['alpha', 'beta']);
    setDashboardState(withProjects(makeState(DAYS), ['alpha', 'beta']));
    const wrapper = mount(UsagePanel);
    expect(wrapper.get('h2').text()).toBe('Token usage · last 14 days');
    expect(wrapper.find('svg').exists()).toBe(false);

    setOpenPopup('usage');
    await nextTick();
    expect(wrapper.find('svg.chart').exists()).toBe(true);
  });

  it('renders bars, series colours, legend, day rows, totals and models', () => {
    setProjectColors(['alpha', 'beta']);
    setDashboardState(withProjects(makeState(DAYS), ['alpha', 'beta']));
    setOpenPopup('usage');
    const wrapper = mount(UsagePanel);

    const rects = wrapper.findAll('rect');
    expect(rects.map((rect) => rect.attributes('data-key'))).toEqual(['2026-10-09|alpha', '2026-10-09|beta', '2026-10-10|alpha']);
    expect(rects[0]?.attributes('style')).toContain('var(--s1)');
    expect(rects[1]?.attributes('style')).toContain('var(--s2)');
    expect(rects[1]?.attributes('data-tip')).toBe('2026-10-09\nbeta: 300 tokens');
    expect(wrapper.findAll('text').map((text) => text.text())).toContain('10-10');

    const legend = wrapper.findAll('.legend-btn');
    expect(legend.map((button) => button.text())).toEqual(['alpha', 'beta']);
    expect(legend[0]?.attributes('aria-pressed')).toBe('true');

    const [dayTable, modelTable] = wrapper.findAll('table');
    expect(dayTable?.findAll('tbody tr').map((row) => row.attributes('data-key'))).toEqual(['2026-10-10', '2026-10-09']);
    expect(dayTable?.get('tfoot').text()).toContain('3.0k');
    expect(dayTable?.get('tfoot').text()).toContain('1.50M');
    expect(modelTable?.findAll('tbody tr').map((row) => row.attributes('data-key'))).toEqual(['model-big', 'model-small']);
  });

  it('updates the bars on the next push while open', async () => {
    setProjectColors(['alpha']);
    setDashboardState(withProjects(makeState([makeDay('2026-10-10', { alpha: 500 })]), ['alpha']));
    setOpenPopup('usage');
    const wrapper = mount(UsagePanel);
    expect(wrapper.findAll('rect')).toHaveLength(1);

    setDashboardState(withProjects(makeState([makeDay('2026-10-10', { alpha: 500 }), makeDay('2026-10-11', { alpha: 40 })]), ['alpha']));
    await nextTick();
    expect(wrapper.findAll('rect')).toHaveLength(2);
  });

  it('hides and shows a series when its legend button is clicked, and keeps the choice across pushes', async () => {
    setProjectColors(['alpha', 'beta']);
    setDashboardState(withProjects(makeState(DAYS), ['alpha', 'beta']));
    setOpenPopup('usage');
    const wrapper = mount(UsagePanel);

    await wrapper.findAll('.legend-btn')[1]?.trigger('click');
    expect(wrapper.findAll('rect').map((rect) => rect.attributes('data-key'))).toEqual(['2026-10-09|alpha', '2026-10-10|alpha']);
    expect(wrapper.findAll('.legend-btn')[1]?.attributes('aria-pressed')).toBe('false');
    expect(wrapper.findAll('.legend-btn')[1]?.attributes('style')).toContain('opacity: 0.45');

    setDashboardState(withProjects(makeState(DAYS), ['alpha', 'beta']));
    await nextTick();
    expect(wrapper.findAll('rect')).toHaveLength(2);

    await wrapper.findAll('.legend-btn')[1]?.trigger('click');
    expect(wrapper.findAll('rect')).toHaveLength(3);
  });

  it('shows a project outside the known list as Other, escaped, and lets it be hidden', async () => {
    setProjectColors(['alpha']);
    setDashboardState(withProjects(makeState([makeDay('2026-10-10', { alpha: 100, '<b>x</b>': 50 })]), ['alpha']));
    setOpenPopup('usage');
    const wrapper = mount(UsagePanel);
    const names = wrapper.findAll('.legend-btn').map((button) => button.text());
    expect(names).toContain('Other');
    expect(wrapper.find('.legend b').exists()).toBe(false);

    const otherIndex = names.indexOf('Other');
    await wrapper.findAll('.legend-btn')[otherIndex]?.trigger('click');
    expect(wrapper.findAll('rect').map((rect) => rect.attributes('data-key'))).toEqual(['2026-10-10|alpha']);
  });
});
