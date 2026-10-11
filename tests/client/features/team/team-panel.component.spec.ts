import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';
import { setDashboardState } from '../../../../src/client/app/dashboard-state.ts';
import { setOpenPopup } from '../../../../src/client/features/popups/open-popup.ts';
import TeamPanel from '../../../../src/client/features/team/team-panel.vue';
import type { DashboardState, TeamBoard } from '../../../../src/shared/types/index.ts';

function makeBoard(overrides: Partial<TeamBoard> = {}): TeamBoard {
  return {
    counts: { backlog: 3, ready: 1, 'in-progress': 2, review: 1, done: 9, blocked: 0 },
    active: {
      inProgress: [{ id: 'T-1', title: 'Build <b>it</b>' }],
      review: [{ id: 'T-2', title: 'Check it' }],
      blocked: [],
    },
    needsYou: [],
    ...overrides,
  };
}

function makeState(team: TeamBoard | null): DashboardState {
  return {
    generatedAtMs: 1,
    projects: [],
    sessions: [],
    subagents: [],
    messages: [],
    usage: { days: [], totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, byModel: {} },
    limits: { source: 'none', fetchedAtMs: null, error: null, windows: [], hits: [] },
    recentSessions: [],
    features: { lan: false, commands: true, permissionModes: [], manageDevices: false },
    team,
    alerts: { items: [], threshold: 80 },
    permissions: [],
  };
}

describe('TeamPanel', () => {
  afterEach(() => setOpenPopup(null));

  it('renders tiles, the non-empty lists and "Nothing needs you." when the popup is open', async () => {
    setDashboardState(makeState(makeBoard()));
    const wrapper = mount(TeamPanel);
    expect(wrapper.text()).toBe('');

    setOpenPopup('team');
    await nextTick();

    expect(wrapper.get('h2').text()).toBe('Team');
    const tiles = wrapper.findAll('.team__tile');
    expect(tiles).toHaveLength(6);
    expect(tiles[2]?.classes()).toContain('team__tile--in-progress');
    expect(tiles[2]?.get('.team__count').text()).toBe('2');
    expect(wrapper.findAll('h3').map((heading) => heading.text())).toEqual(['In progress', 'Review', 'Needs you']);
    expect(wrapper.get('.team__id').text()).toBe('T-1');
    expect(wrapper.text()).toContain('Build <b>it</b>');
    expect(wrapper.find('li b').exists()).toBe(false);
    expect(wrapper.get('.empty').text()).toBe('Nothing needs you.');
  });

  it('renders nothing when the state has no board', async () => {
    setDashboardState(makeState(null));
    setOpenPopup('team');
    const wrapper = mount(TeamPanel);
    await nextTick();

    expect(wrapper.find('h2').exists()).toBe(false);
    expect(wrapper.find('.team__tile').exists()).toBe(false);
  });

  it('updates on the next push and lists who needs you', async () => {
    setDashboardState(makeState(makeBoard()));
    setOpenPopup('team');
    const wrapper = mount(TeamPanel);

    setDashboardState(
      makeState(
        makeBoard({
          counts: { backlog: 0, ready: 0, 'in-progress': 0, review: 0, done: 10, blocked: 1 },
          active: { inProgress: [], review: [], blocked: [{ id: 'T-3', title: 'Stuck' }] },
          needsYou: ['T-3 needs an answer'],
        }),
      ),
    );
    await nextTick();

    expect(wrapper.findAll('h3').map((heading) => heading.text())).toEqual(['Blocked', 'Needs you']);
    expect(wrapper.find('.empty').exists()).toBe(false);
    expect(wrapper.findAll('.team__list')[1]?.text()).toBe('T-3 needs an answer');

    setDashboardState(makeState(null));
    await nextTick();
    expect(wrapper.find('h2').exists()).toBe(false);
  });
});
