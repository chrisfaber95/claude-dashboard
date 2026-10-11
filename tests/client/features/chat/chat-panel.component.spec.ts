import { flushPromises, mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setDashboardState } from '../../../../src/client/app/dashboard-state.ts';
import ChatPanel from '../../../../src/client/features/chat/chat-panel.vue';
import type { DashboardState, SessionInfo } from '../../../../src/shared/types/index.ts';

vi.mock('../../../../src/client/features/controls/controls.view.ts', () => ({ openTranscript: vi.fn() }));

const SESSION: SessionInfo = {
  sessionId: 'abcdef1234567890',
  pid: 1,
  name: 'alpha',
  project: 'demo',
  cwd: 'N:/Projects/demo',
  status: 'idle',
  entrypoint: 'cli',
  kind: 'interactive',
  startedAtMs: 1,
  updatedAtMs: 1,
  branch: null,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

function makeState(sessions: SessionInfo[], permissionModes: DashboardState['features']['permissionModes'] = ['plan', 'auto']): DashboardState {
  return {
    generatedAtMs: 1,
    projects: [],
    sessions,
    subagents: [],
    messages: [],
    usage: { days: [], totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, byModel: {} },
    limits: { source: 'none', fetchedAtMs: null, error: null, windows: [], hits: [] },
    recentSessions: [],
    features: { lan: false, commands: true, permissionModes, manageDevices: false },
    team: null,
    alerts: { items: [], threshold: 80 },
    permissions: [],
  };
}

function mockFetch(response: { ok: boolean; status: number; body: unknown }): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({ ok: response.ok, status: response.status, json: async () => response.body }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function ask(wrapper: VueWrapper, text: string): Promise<void> {
  await wrapper.get('#chat-input').setValue(text);
  await wrapper.get('#chat-form').trigger('submit');
  await flushPromises();
}

function lines(wrapper: VueWrapper): string[] {
  return wrapper.findAll('.chat__msg').map((line) => line.text());
}

function clickButton(wrapper: VueWrapper, label: string): Promise<void> {
  const button = wrapper.findAll('button').find((candidate) => candidate.text() === label);
  return button ? button.trigger('click') : Promise.reject(new Error(`no ${label} button`));
}

describe('ChatPanel', () => {
  beforeEach(() => setDashboardState(makeState([SESSION])));
  afterEach(() => vi.unstubAllGlobals());

  it('starts with the greeting and no confirm box', () => {
    const wrapper = mount(ChatPanel);

    expect(lines(wrapper)).toEqual(['Ask what is going on, or type "help".']);
    expect(wrapper.find('.chat__confirm').exists()).toBe(false);
  });

  it('asks for confirmation, then sends exactly the typed message with the default mode', async () => {
    const fetchMock = mockFetch({ ok: true, status: 200, body: { ok: true, output: '' } });
    const wrapper = mount(ChatPanel);

    await ask(wrapper, 'tell alpha: run <b>the</b> tests');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(wrapper.get('.chat__confirm strong').text()).toBe('alpha');
    expect(wrapper.get('.chat__quote').text()).toBe('run <b>the</b> tests');
    expect(wrapper.find('.chat__quote b').exists()).toBe(false);

    await clickButton(wrapper, 'Confirm');
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/sessions/abcdef1234567890/message');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ prompt: 'run <b>the</b> tests', permissionMode: 'auto' }),
    });
    expect(lines(wrapper).at(-1)).toBe('Sent to alpha.');
    expect(wrapper.find('.chat__confirm').exists()).toBe(false);
  });

  it('cancel sends nothing and says so', async () => {
    const fetchMock = mockFetch({ ok: true, status: 200, body: {} });
    const wrapper = mount(ChatPanel);

    await ask(wrapper, 'tell alpha: hi');
    await clickButton(wrapper, 'Cancel');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(lines(wrapper).at(-1)).toBe('Cancelled. Nothing was sent.');
    expect(wrapper.find('.chat__confirm').exists()).toBe(false);
  });

  it('does not send when the session ended while the confirmation was open', async () => {
    const fetchMock = mockFetch({ ok: true, status: 200, body: {} });
    const wrapper = mount(ChatPanel);

    await ask(wrapper, 'tell alpha: hi');
    setDashboardState(makeState([]));
    await clickButton(wrapper, 'Confirm');
    await flushPromises();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(lines(wrapper).at(-1)).toBe('alpha is no longer running. Nothing was sent.');
  });

  it('shows the summary and its note', async () => {
    const fetchMock = mockFetch({ ok: true, status: 200, body: { text: 'Working on tests.', note: 'Recap, no model.' } });
    const wrapper = mount(ChatPanel);

    await ask(wrapper, 'summarize alpha');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/sessions/abcdef1234567890/summary');
    expect(lines(wrapper).slice(-2)).toEqual(['Working on tests.', 'Recap, no model.']);
  });

  it('shows the fixed error message of a failed request', async () => {
    mockFetch({ ok: false, status: 500, body: { error: 'summary failed' } });
    const wrapper = mount(ChatPanel);

    await ask(wrapper, 'summarize alpha');

    expect(lines(wrapper).at(-1)).toBe('summary failed');
  });

  it('keeps the typed input and the scroll position across state pushes', async () => {
    const wrapper = mount(ChatPanel, { attachTo: document.body });
    const log = wrapper.get<HTMLElement>('#chat-log').element;
    Object.defineProperty(log, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(log, 'clientHeight', { value: 100, configurable: true });

    await wrapper.get('#chat-input').setValue('half a question');
    log.scrollTop = 120;
    setDashboardState(makeState([SESSION]));
    await flushPromises();

    expect(log.scrollTop).toBe(120);
    expect(wrapper.get<HTMLInputElement>('#chat-input').element.value).toBe('half a question');

    await ask(wrapper, 'help');
    expect(log.scrollTop).toBe(120);

    log.scrollTop = 880;
    await ask(wrapper, 'help');
    expect(log.scrollTop).toBe(1000);
    wrapper.unmount();
  });
});
