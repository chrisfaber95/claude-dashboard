import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setDashboardState } from '../../../../src/client/app/dashboard-state.ts';
import { continueSession, openRecentLaunch, stopSession } from '../../../../src/client/features/controls/session-actions.ts';
import ToastStack from '../../../../src/client/features/controls/toast-stack.vue';
import { closeDrawer, useDrawerRequest } from '../../../../src/client/features/controls/transcript-drawer-selection.ts';
import type { DashboardState, SessionInfo } from '../../../../src/shared/types/index.ts';

const TOAST_SHOWN_MS = 6000;

function makeState(): DashboardState {
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const session: SessionInfo = {
    sessionId: 'bg-1a2b3c-full',
    pid: 1,
    name: 'alpha',
    project: 'Alpha',
    cwd: '/p/Alpha',
    status: 'busy',
    entrypoint: 'cli',
    kind: 'bg',
    startedAtMs: 1,
    updatedAtMs: 1,
    branch: null,
    tokens,
  };
  return {
    generatedAtMs: 1,
    projects: [],
    sessions: [session],
    subagents: [],
    messages: [],
    usage: { days: [], totals: tokens, byModel: {} },
    limits: { source: 'none', fetchedAtMs: null, error: null, windows: [], hits: [] },
    recentSessions: [],
    features: { lan: false, commands: true, permissionModes: ['plan'], manageDevices: false },
    team: null,
    alerts: { items: [], threshold: 80 },
    permissions: [],
  };
}

let calls: Array<{ path: string; body: unknown }> = [];
let response: unknown = { ok: true, output: '' };
let isRequestFailing = false;

beforeEach(() => {
  vi.useFakeTimers();
  calls = [];
  response = { ok: true, output: '' };
  isRequestFailing = false;
  vi.stubGlobal('fetch', async (path: string, init?: { body?: string }) => {
    calls.push({ path, body: init?.body ? JSON.parse(init.body) : undefined });
    if (isRequestFailing) throw new Error('network down');
    return { ok: true, status: 200, json: async () => response };
  });
  vi.stubGlobal('confirm', () => true);
  setDashboardState(makeState());
});

afterEach(() => {
  closeDrawer();
  vi.advanceTimersByTime(TOAST_SHOWN_MS); // let the toasts of this test expire
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('stopSession', () => {
  it('posts to the stop endpoint after the confirm and toasts the result, which disappears again', async () => {
    const wrapper = mount(ToastStack);
    await stopSession('bg-1a2b3c-full', 'alpha');
    await flushPromises();

    expect(calls).toEqual([{ path: '/api/sessions/bg-1a2b3c-full/stop', body: {} }]);
    expect(wrapper.get('.toast').text()).toBe('Stopped.');
    expect(wrapper.find('.toast--error').exists()).toBe(false);

    vi.advanceTimersByTime(TOAST_SHOWN_MS);
    await flushPromises();
    expect(wrapper.find('.toast').exists()).toBe(false);
  });

  it('does nothing when the confirm is declined', async () => {
    vi.stubGlobal('confirm', () => false);
    await stopSession('bg-1a2b3c-full', 'alpha');
    expect(calls).toEqual([]);
  });

  it('toasts the command output as an error when the stop fails', async () => {
    response = { ok: false, output: 'no such session' };
    const wrapper = mount(ToastStack);
    await stopSession('bg-1a2b3c-full', 'alpha');
    await flushPromises();

    expect(wrapper.get('.toast--error').text()).toBe('no such session');
  });

  it('toasts the error message when the request throws', async () => {
    isRequestFailing = true;
    const wrapper = mount(ToastStack);
    await stopSession('bg-1a2b3c-full', 'alpha');
    await flushPromises();

    expect(wrapper.get('.toast--error').text()).toBe('network down');
  });
});

describe('continueSession', () => {
  it('posts the prompt and permission mode to the message endpoint', async () => {
    response = { ok: true, id: 'bg-new', output: 'started' };
    const outcome = await continueSession('bg-1a2b3c-full', 'carry on', 'plan');

    expect(calls).toEqual([{ path: '/api/sessions/bg-1a2b3c-full/message', body: { prompt: 'carry on', permissionMode: 'plan' } }]);
    expect(outcome).toEqual({ isOk: true, text: 'Started (bg-new). started' });
  });

  it('reports a command that did not start', async () => {
    response = { ok: false, output: 'folder is gone' };
    expect(await continueSession('bg-1a2b3c-full', 'carry on', 'plan')).toEqual({ isOk: false, text: 'folder is gone' });
  });

  it('reports a request error as a not-ok outcome', async () => {
    isRequestFailing = true;
    expect(await continueSession('bg-1a2b3c-full', 'carry on', 'plan')).toEqual({ isOk: false, text: 'network down' });
  });
});

describe('openRecentLaunch', () => {
  it('opens the transcript of the live session behind a short id', () => {
    openRecentLaunch('bg-1a2b3c', 'Alpha');
    expect(useDrawerRequest().value?.mode).toEqual({ kind: 'transcript', id: 'bg-1a2b3c-full' });
  });

  it('toasts when the session is not known yet', async () => {
    const wrapper = mount(ToastStack);
    openRecentLaunch('bg-ffffff', 'Alpha');
    await flushPromises();

    expect(useDrawerRequest().value).toBeNull();
    expect(wrapper.get('.toast').text()).toBe('Session not found yet, try again in a moment');
  });
});
