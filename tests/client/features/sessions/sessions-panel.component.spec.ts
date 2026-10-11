import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setDashboardState } from '../../../../src/client/app/dashboard-state.ts';
import SessionsPanel from '../../../../src/client/features/sessions/sessions-panel.vue';
import type { DashboardState, RecentSession, SessionInfo } from '../../../../src/shared/types/index.ts';

function makeSession(overrides: Partial<SessionInfo>): SessionInfo {
  return {
    sessionId: 'session-aaaa-1111',
    pid: 1234,
    updatedAtMs: Date.now(),
    name: 'alpha <b>',
    project: 'alpha',
    cwd: 'N:/Projects/alpha',
    status: 'busy',
    branch: 'main',
    kind: 'interactive',
    entrypoint: 'cli',
    startedAtMs: Date.now() - 60_000,
    tokens: { input: 1_000, output: 2_000, cacheRead: 3_000, cacheWrite: 4_000 },
    ...overrides,
  };
}

function makeRecent(overrides: Partial<RecentSession>): RecentSession {
  return { sessionId: 'recent-bbbb-2222', project: 'beta', lastTsMs: Date.now() - 3_600_000, live: false, ...overrides };
}

function makeState(options: { sessions?: SessionInfo[]; recentSessions?: RecentSession[]; hasCommands?: boolean; requestIds?: string[] }): DashboardState {
  return {
    generatedAtMs: 1,
    projects: [],
    sessions: options.sessions ?? [],
    subagents: [],
    messages: [],
    usage: { days: [], totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, byModel: {} },
    limits: { source: 'none', fetchedAtMs: null, error: null, windows: [], hits: [] },
    recentSessions: options.recentSessions ?? [],
    features: { lan: true, commands: options.hasCommands ?? true, permissionModes: [], manageDevices: false },
    team: null,
    alerts: { items: [], threshold: 80 },
    permissions: (options.requestIds ?? []).map((id) => ({ id, sessionId: 'session-aaaa-1111', tool: 'Bash', text: 'ls', status: 'pending', createdMs: 1 })),
  };
}

describe('SessionsPanel', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the empty state without live sessions', () => {
    setDashboardState(makeState({}));
    const wrapper = mount(SessionsPanel);

    expect(wrapper.get('.empty').text()).toBe('No live sessions.');
    expect(wrapper.find('table').exists()).toBe(false);
    expect(wrapper.find('.recent').exists()).toBe(false);
    expect(wrapper.find('.permissions').exists()).toBe(false);
  });

  it('draws a row with escaped text, state dot, token sum and keyed data attributes', () => {
    setDashboardState(makeState({ sessions: [makeSession({})] }));
    const wrapper = mount(SessionsPanel);
    const row = wrapper.get('tbody tr');

    expect(row.attributes('data-key')).toBe('session-aaaa-1111');
    expect(row.get('.dot').classes()).toContain('is-busy');
    expect(row.find('b').exists()).toBe(false);
    expect(row.text()).toContain('alpha <b>');
    expect(row.get('.num').text()).toBe('10.0k');
    expect(row.get('.num').attributes('data-tip')).toBe('in 1.0k · out 2.0k\ncache read 3.0k · write 4.0k');
    expect(row.get('[data-time="up"]').text()).toBe('1m');
    expect(row.findAll('button').map((button) => button.attributes('data-view'))).toEqual(['session-aaaa-1111']);
  });

  it('adds the background badge and Logs and Stop buttons only for background sessions with commands on', () => {
    setDashboardState(makeState({ sessions: [makeSession({ kind: 'bg' })] }));
    const wrapper = mount(SessionsPanel);
    const row = wrapper.get('tbody tr');

    expect(row.get('.badge').text()).toBe('background');
    expect(row.get('[data-logs]').attributes('data-logs')).toBe('session-aaaa-1111');
    expect(row.get('[data-stop]').attributes('data-name')).toBe('alpha <b>');
  });

  it('hides Logs and Stop when commands are off', async () => {
    setDashboardState(makeState({ sessions: [makeSession({ kind: 'background' })], hasCommands: false }));
    const wrapper = mount(SessionsPanel);

    expect(wrapper.find('[data-stop]').exists()).toBe(false);
    expect(wrapper.find('[data-logs]').exists()).toBe(false);
    expect(wrapper.findAll('tbody button')).toHaveLength(1);
  });

  it('lists recent sessions that are not live, at most 12, and follows a new push', async () => {
    const recents = Array.from({ length: 14 }, (_, index) => makeRecent({ sessionId: `recent-${String(index).padStart(2, '0')}-xxxx` }));
    setDashboardState(makeState({ recentSessions: [makeRecent({ sessionId: 'live-session-0', live: true }), ...recents] }));
    const wrapper = mount(SessionsPanel);

    expect(wrapper.findAll('.recent li')).toHaveLength(12);
    expect(wrapper.get('.recent li button').text()).toBe('beta · recent-0');
    expect(wrapper.get('.recent li [data-time="ago"]').text()).toBe('1h ago');

    setDashboardState(makeState({ recentSessions: [] }));
    await flushPromises();
    expect(wrapper.find('.recent').exists()).toBe(false);
  });

  it('keeps the same row element when a push changes its values', async () => {
    setDashboardState(makeState({ sessions: [makeSession({})] }));
    const wrapper = mount(SessionsPanel);
    const before = wrapper.get('tbody tr').element;

    setDashboardState(makeState({ sessions: [makeSession({ status: 'idle' })] }));
    await flushPromises();

    expect(wrapper.get('tbody tr').element).toBe(before);
    expect(wrapper.get('.dot').classes()).toContain('is-idle');
  });

  it('lists pending permission requests under their own heading', () => {
    setDashboardState(makeState({ sessions: [makeSession({})], requestIds: ['req-1', 'req-2'] }));
    const wrapper = mount(SessionsPanel);

    expect(wrapper.get('.permissions').findAll('.permission')).toHaveLength(2);
    expect(wrapper.findAll('h3').map((heading) => heading.text())).toContain('Permission requests');
  });

  it('answering a request disables its buttons in every list that shows it', async () => {
    setDashboardState(makeState({ requestIds: ['req-1'] }));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
    const first = mount(SessionsPanel);
    const second = mount(SessionsPanel);

    await first.get('[data-permission-decide="allow"]').trigger('click');
    await flushPromises();

    expect(second.get('[data-permission-decide="allow"]').attributes('disabled')).toBeDefined();
  });
});
