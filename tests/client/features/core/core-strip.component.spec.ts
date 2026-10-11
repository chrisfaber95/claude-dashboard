import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setDashboardState } from '../../../../src/client/app/dashboard-state.ts';
import CoreStrip from '../../../../src/client/features/core/core-strip.vue';
import type { DashboardState, SessionInfo } from '../../../../src/shared/types/index.ts';

function makeState(sessions: SessionInfo[]): DashboardState {
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

function makeSession(status: string): SessionInfo {
  return {
    sessionId: 'session-1',
    pid: 1,
    name: 'demo',
    project: 'demo',
    cwd: 'N:/Projects/demo',
    status,
    entrypoint: 'cli',
    kind: 'interactive',
    startedAtMs: 1,
    updatedAtMs: 1,
    branch: null,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('section');
  host.id = 'core';
  host.className = 'core';
  document.body.append(host);
});

afterEach(() => {
  host.remove();
  document.documentElement.removeAttribute('data-mood');
});

describe('CoreStrip', () => {
  it('renders the strip markup before the first push', () => {
    const wrapper = mount(CoreStrip, { attachTo: host });

    expect(wrapper.findAll('.core__bar')).toHaveLength(41);
    expect(wrapper.findAll('.core__ripple')).toHaveLength(3);
    expect(wrapper.findAll('.core__think-dot')).toHaveLength(3);
    expect(wrapper.get('.core__live').attributes('role')).toBe('status');
    wrapper.unmount();
  });

  it('puts the mood class on the host and data-mood on <html>', async () => {
    setDashboardState(makeState([]));
    const wrapper = mount(CoreStrip, { attachTo: host });

    expect(host.classList.contains('core--standby')).toBe(true);
    expect(wrapper.get('.core__label').text()).toBe('Standby');
    expect(document.documentElement.getAttribute('data-mood')).toBe('standby');

    setDashboardState(makeState([makeSession('busy')]));
    await nextTick();

    expect(host.classList.contains('core--working')).toBe(true);
    expect(host.classList.contains('core--standby')).toBe(false);
    expect(wrapper.get('.core__label').text()).toBe('Working');
    expect(document.documentElement.getAttribute('data-mood')).toBe('working');
    wrapper.unmount();
  });

  it('keeps the same animated nodes across pushes, also when the mood changes', async () => {
    setDashboardState(makeState([]));
    const wrapper = mount(CoreStrip, { attachTo: host });
    const dot = wrapper.get('.core__dot').element;
    const bar = wrapper.get('.core__bar').element;
    const label = wrapper.get('.core__label').element;
    const htmlBefore = host.innerHTML;

    setDashboardState(makeState([]));
    await nextTick();
    expect(host.innerHTML).toBe(htmlBefore);

    setDashboardState(makeState([makeSession('busy')]));
    await nextTick();
    expect(wrapper.get('.core__dot').element).toBe(dot);
    expect(wrapper.get('.core__bar').element).toBe(bar);
    expect(wrapper.get('.core__label').element).toBe(label);
    wrapper.unmount();
  });

  it('leaves artwork added into the seed slot alone', async () => {
    setDashboardState(makeState([]));
    const wrapper = mount(CoreStrip, { attachTo: host });
    const artwork = document.createElement('div');
    artwork.className = 'rs-pulse';
    wrapper.get('.core__seed').element.append(artwork);

    setDashboardState(makeState([makeSession('busy')]));
    await nextTick();

    expect(wrapper.get('.core__seed').element.contains(artwork)).toBe(true);
    wrapper.unmount();
  });
});
