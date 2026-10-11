import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setDashboardState } from '../../../../src/client/app/dashboard-state.ts';
import AlertsPanel from '../../../../src/client/features/alerts/alerts-panel.vue';
import type { Alert, DashboardState } from '../../../../src/shared/types/index.ts';

const alertOf = (id: string, overrides: Partial<Alert> = {}): Alert => ({
  id,
  kind: 'session',
  title: `title ${id}`,
  detail: `detail ${id}`,
  sinceMs: 1,
  resetsAtMs: null,
  ...overrides,
});

function makeState(items: Alert[], options: { threshold?: number; pendingRequestIds?: string[] } = {}): DashboardState {
  return {
    generatedAtMs: 1,
    projects: [],
    sessions: [],
    subagents: [],
    messages: [],
    usage: { days: [], totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, byModel: {} },
    limits: { source: 'none', fetchedAtMs: null, error: null, windows: [], hits: [] },
    recentSessions: [],
    features: { lan: true, commands: true, permissionModes: [], manageDevices: false },
    team: null,
    alerts: { items, threshold: options.threshold ?? 80 },
    permissions: (options.pendingRequestIds ?? []).map((id) => ({ id, sessionId: 'abcdef123456', tool: 'Bash', text: 'ls', status: 'pending', createdMs: 1 })),
  };
}

function mockFetch(isOk: boolean, body: unknown = {}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({ ok: isOk, status: isOk ? 200 : 500, json: async () => body }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The path and parsed JSON body of the n-th fetch call. */
function callOf(fetchMock: ReturnType<typeof vi.fn>, index: number): { path: unknown; body: unknown } {
  const [path, init] = fetchMock.mock.calls[index] ?? [];
  return { path, body: JSON.parse(String(init?.body)) };
}

describe('AlertsPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '<span id="alert-badge"></span><div id="toasts"></div>';
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lists the alerts with title, detail and reset time, and shows count, badge and highlight', async () => {
    setDashboardState(makeState([alertOf('a'), alertOf('usage:five_hour', { kind: 'usage', resetsAtMs: Date.now() + 3_600_000 })]));
    const wrapper = mount(AlertsPanel, { attachTo: document.body });
    await nextTick();

    expect(wrapper.get('.alerts__count').text()).toBe('2');
    expect(wrapper.get('section').classes()).toContain('has-alerts');
    const rows = wrapper.findAll('.alerts__item');
    expect(rows.map((row) => row.attributes('data-key'))).toEqual(['a', 'usage:five_hour']);
    expect(rows[0]?.get('.alerts__title').text()).toBe('title a');
    expect(rows[0]?.find('[data-time]').exists()).toBe(false);
    expect(rows[1]?.find('[data-time="until"]').exists()).toBe(true);
    const badge = document.querySelector('#alert-badge .alert-badge');
    expect(badge?.textContent).toBe('2');
    expect(badge?.hasAttribute('hidden')).toBe(false);
    wrapper.unmount();
  });

  it('counts pending permission requests in the list, count and badge', async () => {
    setDashboardState(makeState([alertOf('a')], { pendingRequestIds: ['req-1'] }));
    const wrapper = mount(AlertsPanel, { attachTo: document.body });
    await nextTick();

    expect(wrapper.findAll('.permission')).toHaveLength(1);
    expect(wrapper.get('.alerts__count').text()).toBe('2');
    expect(document.querySelector('#alert-badge .alert-badge')?.textContent).toBe('2');
    wrapper.unmount();
  });

  it('shows the empty state and hides the badge and count without alerts', async () => {
    setDashboardState(makeState([]));
    const wrapper = mount(AlertsPanel, { attachTo: document.body });
    await nextTick();

    expect(wrapper.get('.empty').text()).toBe('Nothing needs attention.');
    expect(wrapper.get('section').classes()).not.toContain('has-alerts');
    expect(wrapper.get('.alerts__count').attributes('hidden')).toBeDefined();
    expect(document.querySelector('#alert-badge .alert-badge')?.hasAttribute('hidden')).toBe(true);
    wrapper.unmount();
  });

  it('shows alert text as text, never as markup', async () => {
    setDashboardState(makeState([alertOf('a', { title: '<img src=x onerror=alert(1)>' })]));
    const wrapper = mount(AlertsPanel, { attachTo: document.body });
    await nextTick();

    expect(wrapper.get('.alerts__title').text()).toBe('<img src=x onerror=alert(1)>');
    expect(wrapper.find('.alerts__title img').exists()).toBe(false);
    wrapper.unmount();
  });

  it('dismiss posts the alert id and disables the button', async () => {
    setDashboardState(makeState([alertOf('a')]));
    const fetchMock = mockFetch(true);
    const wrapper = mount(AlertsPanel, { attachTo: document.body });
    await nextTick();

    await wrapper.get('.alerts__item button').trigger('click');
    await flushPromises();
    expect(callOf(fetchMock, 0)).toEqual({ path: '/api/alerts/dismiss', body: { id: 'a' } });
    expect(wrapper.get('.alerts__item button').attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('a failed dismiss re-enables the button and shows a fixed message', async () => {
    setDashboardState(makeState([alertOf('a')]));
    mockFetch(false, { error: 'secret detail' });
    const wrapper = mount(AlertsPanel, { attachTo: document.body });
    await nextTick();

    await wrapper.get('.alerts__item button').trigger('click');
    await flushPromises();
    expect(wrapper.get('.alerts__form .sub').text()).toBe('Could not dismiss the alert.');
    expect(wrapper.get('.alerts__item button').attributes('disabled')).toBeUndefined();
    wrapper.unmount();
  });

  it('saves the threshold, rejects invalid input and keeps what the user is typing', async () => {
    setDashboardState(makeState([], { threshold: 80 }));
    const fetchMock = mockFetch(true);
    const wrapper = mount(AlertsPanel, { attachTo: document.body });
    await nextTick();
    const input = wrapper.get<HTMLInputElement>('input');
    expect(input.element.value).toBe('80');

    await input.setValue('150');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.get('.alerts__form .sub').text()).toBe('Enter a whole number from 1 to 100.');
    expect(fetchMock).not.toHaveBeenCalled();

    await input.setValue('90');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(callOf(fetchMock, 0)).toEqual({ path: '/api/settings/alerts', body: { threshold: 90 } });
    expect(wrapper.get('.alerts__form .sub').text()).toBe('Saved.');

    input.element.focus();
    setDashboardState(makeState([], { threshold: 70 }));
    await nextTick();
    expect(input.element.value).toBe('90');
    input.element.blur();
    setDashboardState(makeState([], { threshold: 60 }));
    await nextTick();
    expect(input.element.value).toBe('60');
    wrapper.unmount();
  });

  it('shows a fixed message when saving the threshold fails', async () => {
    setDashboardState(makeState([]));
    mockFetch(false, { error: 'secret detail' });
    const wrapper = mount(AlertsPanel, { attachTo: document.body });
    await nextTick();

    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('.alerts__form .sub').text()).toBe('Could not save the threshold.');
    wrapper.unmount();
  });

  it('toasts only alerts that appear after the first state', async () => {
    setDashboardState(makeState([alertOf('a')]));
    const wrapper = mount(AlertsPanel, { attachTo: document.body });
    await nextTick();
    expect(document.querySelectorAll('#toasts .alert-toast')).toHaveLength(0);

    setDashboardState(makeState([alertOf('a'), alertOf('b')]));
    await nextTick();
    const toasts = document.querySelectorAll('#toasts .alert-toast');
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.querySelector('strong')?.textContent).toBe('title b');
    wrapper.unmount();
  });
});
