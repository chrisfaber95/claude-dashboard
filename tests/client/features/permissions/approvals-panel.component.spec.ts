import { flushPromises, mount as mountComponent } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setDashboardState } from '../../../../src/client/app/dashboard-state.ts';
import ApprovalsPanel from '../../../../src/client/features/permissions/approvals-panel.vue';
import { setOpenPopup } from '../../../../src/client/features/popups/open-popup.ts';
import type { AuditEntry, DashboardState } from '../../../../src/shared/types/index.ts';

function makeState(isCommandsAllowed: boolean): DashboardState {
  return {
    generatedAtMs: 1,
    projects: [],
    sessions: [],
    subagents: [],
    messages: [],
    usage: { days: [], totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, byModel: {} },
    limits: { source: 'none', fetchedAtMs: null, error: null, windows: [], hits: [] },
    recentSessions: [],
    features: { lan: true, commands: isCommandsAllowed, permissionModes: [], manageDevices: false },
    team: null,
    alerts: { items: [], threshold: 80 },
    permissions: [],
  };
}

const approvals: AuditEntry[] = [
  { ts: '2026-10-11T10:00:00Z', action: 'approval', device: 'Phone', session: '1234567890abcdef', tool: 'Bash <b>', text: 'rm -rf <i>x</i>', outcome: 'deny' },
  { ts: '2026-10-11T09:00:00Z', action: 'approval', deviceId: 'pc', outcome: 'allow' },
];

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('ApprovalsPanel', () => {
  // Every panel watches the shared open-popup ref, so a panel left mounted would load again in later tests.
  const mounted: VueWrapper[] = [];
  const mount = () => {
    const wrapper = mountComponent(ApprovalsPanel);
    mounted.push(wrapper);
    return wrapper;
  };
  const fetchMock = vi.fn<(path: string) => Promise<Response>>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    setDashboardState(makeState(true));
  });
  afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    setOpenPopup(null);
    vi.unstubAllGlobals();
  });

  it('loads nothing while closed and lists the log when the popup opens', async () => {
    fetchMock.mockResolvedValue(respond(200, { approvals }));
    const wrapper = mount();
    expect(fetchMock).not.toHaveBeenCalled();

    setOpenPopup('approvals');
    await flushPromises();

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/approvals');
    const items = wrapper.findAll('.approvals__item');
    expect(items).toHaveLength(2);
    expect(items[0]?.get('.approvals__device').text()).toBe('Phone');
    expect(items[0]?.get('.approvals__session').text()).toBe('12345678');
    expect(items[0]?.get('.approvals__tool').text()).toBe('Bash <b>');
    expect(items[0]?.find('.approvals__tool b').exists()).toBe(false);
    expect(items[0]?.get('.approvals__outcome--deny').text()).toBe('Denied');
    expect(items[0]?.get('.permission__text').text()).toBe('rm -rf <i>x</i>');
    expect(items[1]?.get('.approvals__device').text()).toBe('pc');
    expect(items[1]?.get('.approvals__outcome--allow').text()).toBe('Allowed');
    expect(wrapper.get('#approvals-status').text()).toBe('');
  });

  it('reloads on Refresh and shows the empty note', async () => {
    fetchMock.mockResolvedValue(respond(200, { approvals: [] }));
    setOpenPopup('approvals');
    const wrapper = mount();
    await flushPromises();
    expect(wrapper.get('.empty').text()).toBe('No approvals yet.');

    await wrapper.get('#approvals-refresh').trigger('click');
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shows a fixed message when the request fails, never the server text', async () => {
    fetchMock.mockResolvedValue(respond(500, { error: 'secret path N:/x/y' }));
    setOpenPopup('approvals');
    const wrapper = mount();
    await flushPromises();

    expect(wrapper.get('#approvals-status').text()).toBe('Could not load the approvals.');
    expect(wrapper.text()).not.toContain('secret');
    expect(wrapper.get('#approvals-refresh').attributes('disabled')).toBeUndefined();
  });

  it('shows the same message when the response has an unexpected shape', async () => {
    fetchMock.mockResolvedValue(respond(200, { approvals: 'nope' }));
    setOpenPopup('approvals');
    const wrapper = mount();
    await flushPromises();

    expect(wrapper.get('#approvals-status').text()).toBe('Could not load the approvals.');
  });

  it('renders nothing and does not load while commands are not allowed', async () => {
    setDashboardState(makeState(false));
    setOpenPopup('approvals');
    const wrapper = mount();
    await flushPromises();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(wrapper.find('#approvals-refresh').exists()).toBe(false);
  });
});
