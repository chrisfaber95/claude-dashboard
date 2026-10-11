import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';
import { setDashboardState } from '../../../../src/client/app/dashboard-state.ts';
import { setOpenPopup } from '../../../../src/client/features/popups/open-popup.ts';
import ProjectsPanel from '../../../../src/client/features/projects/projects-panel.vue';
import { setProjectColors } from '../../../../src/client/shared/project-colors.ts';
import type { DashboardState, ProjectInfo, SubagentInfo } from '../../../../src/shared/types/index.ts';

const NOW = Date.now();

function makeProject(overrides: Partial<ProjectInfo>): ProjectInfo {
  return {
    name: 'alpha',
    path: 'N:/Projects/alpha',
    branch: 'main',
    isWorktree: false,
    lastActiveMs: NOW - 120_000,
    liveSessions: 0,
    trusted: true,
    tokensToday: 1_500,
    tokens7d: 2_500_000,
    tokensTotal: 3_000_000,
    ...overrides,
  };
}

const workingSubagent: SubagentInfo = {
  agentId: 'agent',
  sessionId: 'session',
  project: 'alpha',
  agentType: 'general-purpose',
  description: '',
  prompt: '',
  background: false,
  parentAgentId: null,
  startedAtMs: 0,
  lastTsMs: 0,
  state: 'working',
  handedBack: false,
  activity: '',
  result: '',
  tokens: 0,
};

function makeState(projects: ProjectInfo[], subagents: SubagentInfo[] = [], hasCommands = true): DashboardState {
  return {
    generatedAtMs: 1,
    projects,
    sessions: [],
    subagents,
    messages: [],
    usage: { days: [], totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, byModel: {} },
    limits: { source: 'none', fetchedAtMs: null, error: null, windows: [], hits: [] },
    recentSessions: [],
    features: { lan: false, commands: hasCommands, permissionModes: [], manageDevices: false },
    team: null,
    alerts: { items: [], threshold: 80 },
    permissions: [],
  };
}

describe('ProjectsPanel', () => {
  afterEach(() => setOpenPopup(null));

  it('shows no cards while the popup is closed and the current data as soon as it opens', async () => {
    const state = makeState([makeProject({ name: 'alpha' })]);
    setProjectColors(['alpha']);
    setDashboardState(state);
    const wrapper = mount(ProjectsPanel);
    expect(wrapper.get('h2').text()).toBe('Projects');
    expect(wrapper.findAll('.card')).toHaveLength(0);

    setOpenPopup('team');
    await nextTick();
    expect(wrapper.findAll('.card')).toHaveLength(0);

    setOpenPopup('projects');
    await nextTick();
    expect(wrapper.findAll('.card')).toHaveLength(1);
  });

  it('renders the card markup: name, colour, badge, branch, relative time, subagents and token counts', async () => {
    setProjectColors(['alpha', 'beta']);
    setDashboardState(
      makeState([makeProject({ name: 'beta', liveSessions: 2, branch: null, isWorktree: false, trusted: false })], [
        { ...workingSubagent, project: 'beta' },
        { ...workingSubagent, project: 'beta' },
      ]),
    );
    setOpenPopup('projects');
    const wrapper = mount(ProjectsPanel);

    const card = wrapper.get('.card.card--click');
    expect(card.attributes('data-building')).toBe('beta');
    expect(card.attributes('role')).toBe('button');
    expect(card.attributes('aria-label')).toBe('Open the beta building');
    expect(card.get('.card__swatch').attributes('style')).toContain('var(--s2)');
    expect(card.get('.badge').classes()).toContain('badge--live');
    expect(card.get('.badge').text()).toBe('2 live');
    const lines = card.findAll('.sub').map((line) => line.text());
    expect(lines[0]).toBe('no git · not trusted for tasks');
    expect(card.get('[data-tip]').attributes('data-tip')).toContain('accept the trust prompt');
    expect(lines[1]).toBe('active 2m ago · 2 subagents working');
    expect(card.get('[data-time="ago"]').attributes('data-ms')).toBe(String(NOW - 120_000));
    expect(lines[2]).toBe('today 1.5k · 7d 2.50M tokens');
  });

  it('shows idle, worktree and no trust note when commands are off, and escapes names', async () => {
    setDashboardState(makeState([makeProject({ name: '<b>x</b>', isWorktree: true, trusted: false })], [], false));
    setOpenPopup('projects');
    const wrapper = mount(ProjectsPanel);

    expect(wrapper.find('.card b').exists()).toBe(false);
    expect(wrapper.get('.badge').classes()).not.toContain('badge--live');
    expect(wrapper.get('.badge').text()).toBe('idle');
    expect(wrapper.get('.sub').text()).toBe('main · worktree');
    expect(wrapper.text()).toContain('<b>x</b>');
  });

  it('updates cards on the next push while open, keeping the card element', async () => {
    setDashboardState(makeState([makeProject({ tokensToday: 1_000 })]));
    setOpenPopup('projects');
    const wrapper = mount(ProjectsPanel);
    const cardBefore = wrapper.get('.card').element;

    setDashboardState(makeState([makeProject({ tokensToday: 2_000, liveSessions: 1 })]));
    await nextTick();

    expect(wrapper.get('.card').text()).toContain('today 2.0k');
    expect(wrapper.get('.badge').text()).toBe('1 live');
    expect(wrapper.get('.card').element).toBe(cardBefore);
  });
});
