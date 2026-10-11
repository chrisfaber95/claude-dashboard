import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setDashboardState } from '../../../../src/client/app/dashboard-state.ts';
import PermissionRequests from '../../../../src/client/features/permissions/permission-requests.vue';
import { PC_HINT } from '../../../../src/client/features/permissions/permissions.logic.ts';
import type { DashboardState } from '../../../../src/shared/types/index.ts';

function makeState(options: { isAnswerable: boolean; requestIds?: string[] }): DashboardState {
  const requestIds = options.requestIds ?? ['req-1'];
  return {
    generatedAtMs: 1,
    projects: [],
    sessions: [],
    subagents: [],
    messages: [],
    usage: { days: [], totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, byModel: {} },
    limits: { source: 'none', fetchedAtMs: null, error: null, windows: [], hits: [] },
    recentSessions: [],
    features: { lan: true, commands: true, permissionModes: [], manageDevices: !options.isAnswerable },
    team: null,
    alerts: { items: [], threshold: 80 },
    permissions: requestIds.map((id) => ({ id, sessionId: 'abcdef123456', tool: 'Bash <b>', text: 'rm -rf /tmp/x', status: 'pending', createdMs: 1 })),
  };
}

function mockFetch(response: { ok: boolean; status: number; body: unknown }): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({ ok: response.ok, status: response.status, json: async () => response.body }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('PermissionRequests', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the request with Approve and Deny when this device can answer', () => {
    setDashboardState(makeState({ isAnswerable: true }));
    const wrapper = mount(PermissionRequests, { props: { context: 'sessions' } });

    expect(wrapper.get('.permission__tool').text()).toBe('Bash <b>');
    expect(wrapper.find('.permission__tool b').exists()).toBe(false);
    expect(wrapper.get('.permission__head .sub').text()).toBe('abcdef12');
    expect(wrapper.findAll('button').map((button) => button.text())).toEqual(['Approve', 'Deny']);
  });

  it('shows only the hint and no buttons when this device cannot answer', () => {
    setDashboardState(makeState({ isAnswerable: false }));
    const wrapper = mount(PermissionRequests, { props: { context: 'alerts' } });

    expect(wrapper.findAll('button')).toHaveLength(0);
    expect(wrapper.get('.permission__hint').text()).toBe(PC_HINT);
  });

  it.each([
    ['Approve', 'allow'],
    ['Deny', 'deny'],
  ])('%s posts the %s decision and stays busy until the push', async (label, decision) => {
    setDashboardState(makeState({ isAnswerable: true }));
    const fetchMock = mockFetch({ ok: true, status: 200, body: {} });
    const wrapper = mount(PermissionRequests, { props: { context: 'sessions' } });

    await wrapper.findAll('button').find((button) => button.text() === label)?.trigger('click');
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/permissions/req-1');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ decision }) });
    expect(wrapper.findAll('button').every((button) => button.attributes('disabled') !== undefined)).toBe(true);

    setDashboardState(makeState({ isAnswerable: true, requestIds: [] }));
    await flushPromises();
    expect(wrapper.find('.permission').exists()).toBe(false);
  });

  it('shows a fixed message and re-enables the buttons after an error', async () => {
    setDashboardState(makeState({ isAnswerable: true }));
    mockFetch({ ok: false, status: 409, body: { error: 'permission request already answered or expired' } });
    const wrapper = mount(PermissionRequests, { props: { context: 'sessions' } });

    await wrapper.get('button').trigger('click');
    await flushPromises();

    expect(wrapper.get('.permission__status').text()).toBe('This request expired or was already answered.');
    expect(wrapper.findAll('button').every((button) => button.attributes('disabled') === undefined)).toBe(true);
  });

  it('maps an unknown server error to the generic message', async () => {
    setDashboardState(makeState({ isAnswerable: true }));
    mockFetch({ ok: false, status: 500, body: { error: 'secret stack trace' } });
    const wrapper = mount(PermissionRequests, { props: { context: 'sessions' } });

    await wrapper.get('button').trigger('click');
    await flushPromises();

    expect(wrapper.get('.permission__status').text()).toBe('Could not send the answer.');
  });
});
