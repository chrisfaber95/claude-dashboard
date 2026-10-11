import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setDashboardState } from '../../../../src/client/app/dashboard-state.ts';
import RunPanel from '../../../../src/client/features/controls/run-panel.vue';
import type { AuditEntry, DashboardState, ProjectInfo, SessionInfo } from '../../../../src/shared/types/index.ts';

const launchEntries: AuditEntry[] = [
  { ts: '2026-10-11T10:00:00.000Z', action: 'start', project: 'Alpha', session: 'bg-1a2b3c', goal: '<b>fix</b> the build', device: 'This PC', ok: true },
  { ts: '2026-10-11T09:00:00.000Z', action: 'start', project: 'Beta', goal: 'broken', device: 'Phone', ok: false },
];

function makeProject(name: string, trusted: boolean): ProjectInfo {
  return { name, path: `/p/${name}`, branch: null, isWorktree: false, lastActiveMs: null, liveSessions: 0, trusted, tokensToday: 0, tokens7d: 0, tokensTotal: 0 };
}

function makeSession(sessionId: string): SessionInfo {
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  return { sessionId, pid: 1, name: 'alpha', project: 'Alpha', cwd: '/p/Alpha', status: 'busy', entrypoint: 'cli', kind: 'interactive', startedAtMs: 1, updatedAtMs: 1, branch: null, tokens };
}

function makeState(): DashboardState {
  return {
    generatedAtMs: 1,
    projects: [makeProject('Alpha', true), makeProject('Beta', false)],
    sessions: [],
    subagents: [],
    messages: [],
    usage: { days: [], totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, byModel: {} },
    limits: { source: 'none', fetchedAtMs: null, error: null, windows: [], hits: [] },
    recentSessions: [],
    features: { lan: false, commands: true, permissionModes: ['plan', 'default', 'acceptEdits', 'auto'], manageDevices: false },
    team: null,
    alerts: { items: [], threshold: 80 },
    permissions: [],
  };
}

interface FetchCall {
  path: string;
  body: unknown;
}

let calls: FetchCall[] = [];
let commandResponse: unknown = { ok: true, id: 'bg-new', output: 'started' };

beforeEach(() => {
  calls = [];
  commandResponse = { ok: true, id: 'bg-new', output: 'started' };
  vi.stubGlobal('fetch', async (path: string, init?: { body?: string }) => {
    calls.push({ path, body: init?.body ? JSON.parse(init.body) : undefined });
    const payload = path === '/api/launches' ? { launches: launchEntries } : commandResponse;
    return { ok: true, status: 200, json: async () => payload };
  });
  vi.stubGlobal('confirm', () => true);
  setDashboardState(makeState());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RunPanel', () => {
  it('lists projects and permission modes with auto preselected', async () => {
    const wrapper = mount(RunPanel);
    await flushPromises();
    const projects = wrapper.findAll('#run-project option').map((option) => option.text());
    expect(projects).toEqual(['Alpha', 'Beta (not trusted yet)']);
    expect(wrapper.findAll('#run-mode option')).toHaveLength(4);
    expect(wrapper.get<HTMLSelectElement>('#run-mode').element.value).toBe('auto');
  });

  it('shows the recent launches escaped, with state and a View button only for started sessions', async () => {
    const wrapper = mount(RunPanel);
    await flushPromises();
    const items = wrapper.findAll('.recent__item');
    expect(items).toHaveLength(2);
    expect(wrapper.find('.recent__prompt b').exists()).toBe(false);
    expect(items[0]?.get('.recent__prompt').text()).toBe('<b>fix</b> the build');
    expect(items[0]?.get('.recent__state').text()).toBe('not live');
    expect(items[0]?.get('[data-recent]').attributes('data-recent')).toBe('bg-1a2b3c');
    expect(items[1]?.classes()).toContain('is-failed');
    expect(items[1]?.find('[data-recent]').exists()).toBe(false);
    expect(wrapper.get('#recent').attributes('hidden')).toBeUndefined();
  });

  it('marks a launch running when its session is live', async () => {
    const wrapper = mount(RunPanel);
    await flushPromises();
    const live = makeState();
    live.sessions = [makeSession('bg-1a2b3c-full')];
    setDashboardState(live);
    await flushPromises();
    expect(wrapper.findAll('.recent__item')[0]?.classes()).toContain('is-live');
    expect(wrapper.findAll('.recent__state')[0]?.text()).toBe('running');
  });

  it('posts the trimmed goal, shows the status, clears the fields and reloads the list', async () => {
    const wrapper = mount(RunPanel);
    await flushPromises();
    await wrapper.get('#run-goal').setValue('  ship it  ');
    await wrapper.get('#run-notes').setValue(' some notes ');
    await wrapper.get('#run-project').setValue('Beta');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    const post = calls.find((call) => call.path === '/api/commands');
    expect(post?.body).toEqual({ project: 'Beta', goal: 'ship it', notes: 'some notes', permissionMode: 'auto' });
    expect(wrapper.get('#run-status').text()).toContain('Started (bg-new)');
    expect(wrapper.get<HTMLTextAreaElement>('#run-goal').element.value).toBe('');
    expect(wrapper.get<HTMLTextAreaElement>('#run-notes').element.value).toBe('');
    expect(calls.filter((call) => call.path === '/api/launches')).toHaveLength(2);
  });

  it('keeps the typed text after a failed start', async () => {
    commandResponse = { ok: false, output: 'no such project' };
    const wrapper = mount(RunPanel);
    await flushPromises();
    await wrapper.get('#run-goal').setValue('do it');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('#run-status').text()).toBe('no such project');
    expect(wrapper.get<HTMLTextAreaElement>('#run-goal').element.value).toBe('do it');
  });

  it('sends an empty goal without a confirm so the server refuses it', async () => {
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmSpy);
    commandResponse = { ok: false, output: 'Goal is required.' };
    const wrapper = mount(RunPanel);
    await flushPromises();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(calls.find((call) => call.path === '/api/commands')?.body).toMatchObject({ goal: '' });
    expect(wrapper.get('#run-status').text()).toBe('Goal is required.');
  });

  it('starts nothing when the confirm is declined', async () => {
    vi.stubGlobal('confirm', () => false);
    const wrapper = mount(RunPanel);
    await flushPromises();
    await wrapper.get('#run-goal').setValue('do it');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(calls.some((call) => call.path === '/api/commands')).toBe(false);
  });
});
