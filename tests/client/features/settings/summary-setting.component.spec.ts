import { flushPromises, mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setDashboardState } from '../../../../src/client/app/dashboard-state.ts';
import SummarySetting from '../../../../src/client/features/settings/summary-setting.vue';
import type { DashboardState } from '../../../../src/shared/types/index.ts';

function makeState(commands: boolean): DashboardState {
  return {
    generatedAtMs: 1,
    projects: [],
    sessions: [],
    subagents: [],
    messages: [],
    usage: { days: [], totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, byModel: {} },
    limits: { source: 'none', fetchedAtMs: null, error: null, windows: [], hits: [] },
    recentSessions: [],
    features: { lan: false, commands, permissionModes: [], manageDevices: false },
    team: null,
    alerts: { items: [], threshold: 80 },
    permissions: [],
  };
}

interface FetchCall {
  method: string;
  body: unknown;
}

let calls: FetchCall[] = [];
let getReply: { status: number; json: unknown } = { status: 200, json: { summary: 'model' } };
let postStatus = 200;
let wrapper: VueWrapper | null = null;

beforeEach(() => {
  calls = [];
  getReply = { status: 200, json: { summary: 'model' } };
  postStatus = 200;
  vi.stubGlobal('fetch', async (_path: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, body: init?.body ? JSON.parse(init.body) : undefined });
    const reply = method === 'GET' ? getReply : { status: postStatus, json: {} };
    return { ok: reply.status < 400, status: reply.status, json: async () => reply.json };
  });
  setDashboardState(makeState(true));
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.unstubAllGlobals();
});

async function mountSetting(): Promise<VueWrapper> {
  wrapper = mount(SummarySetting);
  await flushPromises();
  return wrapper;
}

describe('SummarySetting', () => {
  it('loads the saved mode and offers both options', async () => {
    const view = await mountSetting();
    const select = view.get('select');
    expect(select.findAll('option').map((option) => option.attributes('value'))).toEqual(['recap', 'model']);
    expect(select.element).toHaveProperty('value', 'model');
  });

  it('shows a fixed text when the load fails', async () => {
    getReply = { status: 500, json: { error: 'secret detail' } };
    const view = await mountSetting();
    expect(view.get('#summary-status').text()).toBe('Could not load the summary setting.');
  });

  it('saves a changed mode and reports it', async () => {
    const view = await mountSetting();
    await view.get('select').setValue('recap');
    await flushPromises();
    expect(calls.at(-1)).toEqual({ method: 'POST', body: { summary: 'recap' } });
    expect(view.get('#summary-status').text()).toBe('Saved.');
  });

  it('puts the previous mode back when saving fails', async () => {
    const view = await mountSetting();
    postStatus = 500;
    await view.get('select').setValue('recap');
    await flushPromises();
    expect(view.get('select').element).toHaveProperty('value', 'model');
    expect(view.get('#summary-status').text()).toBe('Could not save the summary setting.');
  });

  it('shows the note only when commands are off and the mode is model', async () => {
    const view = await mountSetting();
    expect(view.get('#summary-note').attributes('hidden')).toBeDefined();

    setDashboardState(makeState(false));
    await flushPromises();
    expect(view.get('#summary-note').attributes('hidden')).toBeUndefined();

    await view.get('select').setValue('recap');
    await flushPromises();
    expect(view.get('#summary-note').attributes('hidden')).toBeDefined();
  });
});
