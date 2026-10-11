import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../../src/client/app/App.vue';
import { setDashboardState } from '../../../src/client/app/dashboard-state.ts';
import type { DashboardState } from '../../../src/shared/types/index.ts';

function makeState(options: { isLan: boolean }): DashboardState {
  return {
    generatedAtMs: 1,
    projects: [],
    sessions: [],
    subagents: [],
    messages: [],
    usage: { days: [], totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, byModel: {} },
    limits: { source: 'none', fetchedAtMs: null, error: null, windows: [], hits: [] },
    recentSessions: [],
    features: { lan: options.isLan, commands: false, permissionModes: [], manageDevices: false },
    team: null,
    alerts: { items: [], threshold: 80 },
    permissions: [],
  };
}

class FakeEventSource {
  static instance: FakeEventSource | undefined;
  onmessage: ((message: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeEventSource.instance = this;
  }
}

const failingPanel = defineComponent({
  setup() {
    throw new Error('panel broke');
  },
});
const workingPanel = defineComponent({ render: () => h('p', { class: 'working' }, 'still here') });

const PANELS = ['AlertsPanel', 'BuildingDialog', 'ToastStack', 'TranscriptDrawer', 'CoreStrip', 'PopupShell', 'SessionsPanel', 'Tooltip'];
const stubworkingPanels = Object.fromEntries(PANELS.map((name) => [name, true]));

describe('App', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-skin');
    document.documentElement.removeAttribute('data-theme');
    localStorage.clear();
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lays out the header, the panel hosts and the overlay roots', () => {
    const wrapper = mount(App, { global: { stubs: stubworkingPanels } });
    for (const id of ['core', 'popup-bar', 'limits', 'alerts', 'sessions', 'render-warn']) {
      expect(wrapper.find(`main #${id}`).exists(), id).toBe(true);
    }
    for (const id of ['alert-badge', 'conn', 'skin', 'theme', 'logout', 'toast-root', 'building-dialog', 'transcript-drawer', 'toasts', 'tip-root']) {
      expect(wrapper.find(`#${id}`).exists(), id).toBe(true);
    }
    expect(wrapper.get('#render-warn').attributes('hidden')).toBeDefined();
    wrapper.unmount();
  });

  it('shows the connection status and the logout button from the pushed state', async () => {
    const wrapper = mount(App, { global: { stubs: stubworkingPanels } });
    expect(wrapper.get('#conn').text()).toBe('connecting…');
    expect(wrapper.get('#logout').attributes('hidden')).toBeDefined();

    FakeEventSource.instance?.onmessage?.({ data: JSON.stringify(makeState({ isLan: true })) });
    await flushPromises();
    expect(wrapper.get('#conn').text()).toBe('live');
    expect(wrapper.get('#conn').classes()).toContain('is-live');
    expect(wrapper.get('#logout').attributes('hidden')).toBeUndefined();

    FakeEventSource.instance?.onerror?.();
    await flushPromises();
    expect(wrapper.get('#conn').text()).toBe('reconnecting…');
    wrapper.unmount();
  });

  it('keeps the other panels when one panel fails and clears the warning on the next push', async () => {
    const wrapper = mount(App, {
      global: { stubs: { ...stubworkingPanels, LimitsPanel: failingPanel, SessionsPanel: workingPanel } },
    });
    await flushPromises();
    expect(wrapper.get('#render-warn').attributes('hidden')).toBeUndefined();
    expect(wrapper.get('#sessions .working').text()).toBe('still here');

    setDashboardState(makeState({ isLan: false }));
    await flushPromises();
    expect(wrapper.get('#render-warn').attributes('hidden')).toBeDefined();
    wrapper.unmount();
  });

  it('shows the warning for an unreadable push and clears it with the next good one', async () => {
    const wrapper = mount(App, { global: { stubs: stubworkingPanels } });
    FakeEventSource.instance?.onmessage?.({ data: 'not json' });
    await flushPromises();
    expect(wrapper.get('#render-warn').attributes('hidden')).toBeUndefined();

    FakeEventSource.instance?.onmessage?.({ data: JSON.stringify(makeState({ isLan: false })) });
    await flushPromises();
    expect(wrapper.get('#render-warn').attributes('hidden')).toBeDefined();
    wrapper.unmount();
  });

  it('stores the chosen skin and hides the theme toggle in a dark-only skin', async () => {
    const wrapper = mount(App, { global: { stubs: stubworkingPanels } });
    await wrapper.get('#skin').setValue('copilot');
    await flushPromises();
    expect(localStorage.getItem('skin')).toBe('copilot');
    expect(document.documentElement.getAttribute('data-skin')).toBe('copilot');
    expect(wrapper.get('#theme').attributes('hidden')).toBeDefined();

    await wrapper.get('#skin').setValue('classic');
    await flushPromises();
    expect(document.documentElement.hasAttribute('data-skin')).toBe(false);
    expect(wrapper.get('#theme').attributes('hidden')).toBeUndefined();
    wrapper.unmount();
  });
});
