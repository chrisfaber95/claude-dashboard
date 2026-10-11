import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';
import { setDashboardState } from '../../../../src/client/app/dashboard-state.ts';
import MessagesPanel from '../../../../src/client/features/messages/messages-panel.vue';
import { setOpenPopup } from '../../../../src/client/features/popups/open-popup.ts';
import type { DashboardState, MessageInfo, SessionInfo } from '../../../../src/shared/types/index.ts';

const NOW = Date.now();

function makeMessage(overrides: Partial<MessageInfo>): MessageInfo {
  return {
    tsMs: NOW - 180_000,
    kind: 'session',
    direction: 'out',
    sessionId: 'session-a',
    sessionName: 'alpha',
    peer: 'beta',
    snippet: 'Please review <b>this</b>',
    ...overrides,
  };
}

function makeSession(name: string): SessionInfo {
  // Only the name is read by the panel; the rest of the record is irrelevant here.
  return Object.assign(Object.create(null), { name });
}

function makeState(messages: MessageInfo[], sessionNames: string[] = []): DashboardState {
  return {
    generatedAtMs: 1,
    projects: [],
    sessions: sessionNames.map(makeSession),
    subagents: [],
    messages,
    usage: { days: [], totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, byModel: {} },
    limits: { source: 'none', fetchedAtMs: null, error: null, windows: [], hits: [] },
    recentSessions: [],
    features: { lan: false, commands: true, permissionModes: [], manageDevices: false },
    team: null,
    alerts: { items: [], threshold: 80 },
    permissions: [],
  };
}

describe('MessagesPanel', () => {
  afterEach(() => setOpenPopup(null));

  it('derives nothing while the popup is closed and the current data as soon as it opens', async () => {
    setDashboardState(makeState([makeMessage({})]));
    const wrapper = mount(MessagesPanel);
    expect(wrapper.get('h2').text()).toBe('Session communication');
    expect(wrapper.find('svg').exists()).toBe(false);
    expect(wrapper.findAll('.feed li')).toHaveLength(0);

    setOpenPopup('projects');
    await nextTick();
    expect(wrapper.findAll('.feed li')).toHaveLength(0);

    setOpenPopup('comms');
    await nextTick();
    expect(wrapper.findAll('.feed li')).toHaveLength(1);
  });

  it('draws the graph with nodes, edges, tooltips and a feed with relative times', () => {
    setDashboardState(
      makeState([makeMessage({}), makeMessage({ tsMs: NOW - 60_000 }), makeMessage({ kind: 'subagent', direction: 'in', peer: 'gamma' })], ['alpha']),
    );
    setOpenPopup('comms');
    const wrapper = mount(MessagesPanel);

    expect(wrapper.get('svg.chart').attributes('viewBox')).toBe('0 0 420 260');
    expect(wrapper.get('svg').attributes('aria-label')).toBe('Message graph between sessions');
    expect(wrapper.findAll('circle')).toHaveLength(2);
    expect(wrapper.findAll('.edge')).toHaveLength(1);
    expect(wrapper.get('.edge').attributes('stroke-width')).toBe('3');
    expect(wrapper.get('[data-tip]').attributes('data-tip')).toBe('alpha → beta: 2 messages');
    const circles = wrapper.findAll('circle');
    expect(circles[0]?.attributes('opacity')).toBe('1');
    expect(circles[1]?.attributes('opacity')).toBe('0.5');
    expect(wrapper.findAll('.node-label').map((label) => label.text())).toEqual(['alpha', 'beta']);
    expect(wrapper.get('p.sub').text()).toBe('2 session messages · 1 subagent hand-back (recent)');

    const items = wrapper.findAll('.feed li');
    expect(items).toHaveLength(3);
    expect(items[0]?.get('.feed__meta').text()).toBe('alpha → beta · session message · 3m ago');
    expect(items[0]?.get('[data-time="ago"]').attributes('data-ms')).toBe(String(NOW - 180_000));
    expect(items[2]?.get('.feed__meta').text()).toContain('gamma → alpha · subagent hand-back');
    expect(items[0]?.text()).toContain('Please review <b>this</b>');
    expect(wrapper.find('.feed b').exists()).toBe(false);
  });

  it('shows the empty states when there are no messages', () => {
    setDashboardState(makeState([]));
    setOpenPopup('comms');
    const wrapper = mount(MessagesPanel);

    expect(wrapper.get('.empty').text()).toBe('No session-to-session messages found yet.');
    expect(wrapper.get('.feed .empty').text()).toBe('Nothing yet.');
    expect(wrapper.get('p.sub').text()).toBe('0 session messages · 0 subagent hand-backs (recent)');
  });

  it('shortens long node names and updates on the next push while open', async () => {
    setDashboardState(makeState([makeMessage({ peer: 'a-very-long-session-name-indeed' })]));
    setOpenPopup('comms');
    const wrapper = mount(MessagesPanel);
    expect(wrapper.findAll('.node-label')[1]?.text()).toBe('a-very-long-sessi…');

    setDashboardState(makeState([makeMessage({}), makeMessage({ snippet: 'second' })]));
    await nextTick();

    expect(wrapper.findAll('.feed li')).toHaveLength(2);
    expect(wrapper.get('p.sub').text()).toContain('2 session messages');
  });
});
