import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isDashboardState, useDashboardState } from '../../../src/client/app/dashboard-state.ts';
import { mountComponent } from '../../../src/client/app/mount-component.ts';
import { connectStateStream, useConnectionStatus } from '../../../src/client/app/state-stream.ts';
import type { DashboardState } from '../../../src/shared/types/index.ts';
import StateProbe from './state-probe.vue';

function makeState(sessionCount: number): DashboardState {
  const sessions: DashboardState['sessions'] = Array.from({ length: sessionCount }, (_, index) => ({
    sessionId: `session-${index}`,
    pid: index,
    name: 'probe',
    project: 'probe',
    cwd: '',
    status: 'idle',
    entrypoint: 'cli',
    kind: 'interactive',
    startedAtMs: 0,
    updatedAtMs: 0,
    branch: null,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }));
  return {
    generatedAtMs: 1,
    projects: [],
    sessions,
    subagents: [],
    messages: [],
    usage: { days: [], totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, byModel: {} },
    limits: { source: 'none', fetchedAtMs: null, error: null, windows: [], hits: [] },
    recentSessions: [],
    features: { lan: false, commands: false, permissionModes: [], manageDevices: false },
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

describe('isDashboardState', () => {
  it('accepts a full state and rejects other values', () => {
    expect(isDashboardState(makeState(0))).toBe(true);
    expect(isDashboardState(null)).toBe(false);
    expect(isDashboardState({})).toBe(false);
    expect(isDashboardState({ ...makeState(0), sessions: 'x' })).toBe(false);
  });
});

describe('state store fed by the state stream', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('stores every push and re-renders a reading component', async () => {
    const wrapper = mount(StateProbe);
    connectStateStream(vi.fn());

    FakeEventSource.instance?.onmessage?.({ data: JSON.stringify(makeState(2)) });
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toBe('2 sessions');
    expect(useConnectionStatus().value).toBe('live');

    FakeEventSource.instance?.onmessage?.({ data: JSON.stringify(makeState(5)) });
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toBe('5 sessions');
    expect(useDashboardState().value?.sessions).toHaveLength(5);
  });

  it('keeps the old state and reports a bad push', () => {
    const before = useDashboardState().value;
    const onBadPush = vi.fn();
    connectStateStream(onBadPush);

    FakeEventSource.instance?.onmessage?.({ data: '{"sessions":1}' });
    FakeEventSource.instance?.onmessage?.({ data: 'not json' });

    expect(onBadPush).toHaveBeenCalledTimes(2);
    expect(useDashboardState().value).toBe(before);
  });
});

describe('mountComponent', () => {
  it('mounts into an existing element and ignores a missing one', () => {
    document.body.innerHTML = '<div id="probe-host"></div>';

    expect(mountComponent(StateProbe, 'missing')).toBeNull();
    const app = mountComponent(StateProbe, 'probe-host');

    expect(app).not.toBeNull();
    expect(document.getElementById('probe-host')?.textContent).toMatch(/sessions|waiting/);
  });
});
