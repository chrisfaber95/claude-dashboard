import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  return Object.assign(Object.create(null), { name, sessionId: `session-${name}`, updatedAtMs: 0 });
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

  it('draws shops, a postman and a feed with relative times', () => {
    setDashboardState(
      makeState([makeMessage({ tsMs: Date.now() - 1000 }), makeMessage({ tsMs: NOW - 60_000 }), makeMessage({ kind: 'subagent', direction: 'in', peer: 'gamma' })], ['alpha']),
    );
    setOpenPopup('comms');
    const wrapper = mount(MessagesPanel);

    expect(wrapper.get('svg.city').attributes('viewBox')).toBe('0 0 400 112');
    expect(wrapper.findAll('.city__shop')).toHaveLength(2);
    expect(wrapper.get('.city__shop.is-active .city__status').text()).toBe('active');
    expect(wrapper.get('.city__shop.is-stopped .city__status').text()).toBe('stopped');
    expect(wrapper.findAll('.node-label').map((label) => label.text())).toEqual(['alpha', 'beta']);
    expect(wrapper.find('.edge').exists()).toBe(false);
    expect(wrapper.get('p.sub').text()).toBe('2 session messages · 1 subagent hand-back (recent)');

    const items = wrapper.findAll('.feed li');
    expect(items).toHaveLength(3);
    expect(items[1]?.get('[data-time="ago"]').attributes('data-ms')).toBe(String(NOW - 60_000));
    expect(items[2]?.get('.feed__meta').text()).toContain('gamma → alpha · subagent hand-back');
    expect(items[0]?.text()).toContain('Please review <b>this</b>');
    expect(wrapper.find('.feed b').exists()).toBe(false);
  });

  it('shows one postman for a fresh message and none, with no animation frame, for old ones', async () => {
    const frameSpy = vi.spyOn(globalThis, 'requestAnimationFrame');
    setDashboardState(makeState([makeMessage({ tsMs: NOW - 120_000 })], ['alpha', 'beta']));
    setOpenPopup('comms');
    const wrapper = mount(MessagesPanel);
    expect(wrapper.findAll('.city__postman')).toHaveLength(0);
    expect(frameSpy).not.toHaveBeenCalled();

    setDashboardState(makeState([makeMessage({ tsMs: Date.now() - 1000 })], ['alpha', 'beta']));
    await nextTick();
    const postman = wrapper.get('.city__postman');
    expect(postman.attributes('data-tip')).toBe('alpha → beta');
    expect(postman.attributes('style')).toContain('--from-x');
    expect(frameSpy).not.toHaveBeenCalled();
    frameSpy.mockRestore();
  });

  it('shows the empty states when there are no messages', () => {
    setDashboardState(makeState([]));
    setOpenPopup('comms');
    const wrapper = mount(MessagesPanel);

    expect(wrapper.get('.empty').text()).toBe('No sessions or messages found yet.');
    expect(wrapper.get('.feed .empty').text()).toBe('Nothing yet.');
    expect(wrapper.get('p.sub').text()).toBe('0 session messages · 0 subagent hand-backs (recent)');
  });

  it('shows "+N more" workers and updates on the next push while open', async () => {
    const subagents = Array.from({ length: 8 }, (_, index) =>
      Object.assign(Object.create(null), { sessionId: 'session-alpha', agentId: `agent-${index}`, agentType: 'coder', activity: 'work', state: 'working' }),
    );
    setDashboardState({ ...makeState([makeMessage({})], ['alpha']), subagents });
    setOpenPopup('comms');
    const wrapper = mount(MessagesPanel);
    expect(wrapper.findAll('.city__worker')).toHaveLength(6);
    expect(wrapper.get('.city__more').text()).toBe('+2 more');

    setDashboardState(makeState([makeMessage({}), makeMessage({ snippet: 'second' })]));
    await nextTick();

    expect(wrapper.findAll('.feed li')).toHaveLength(2);
    expect(wrapper.get('p.sub').text()).toContain('2 session messages');
  });

  it('labels a quiet session as idle with minutes', () => {
    setDashboardState(makeState([makeMessage({ tsMs: NOW - 12 * 60_000 })], ['alpha']));
    setOpenPopup('comms');
    const wrapper = mount(MessagesPanel);

    expect(wrapper.get('.city__shop.is-idle .city__status').text()).toBe('idle 12 min');
  });
});
