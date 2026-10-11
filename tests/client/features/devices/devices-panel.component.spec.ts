import { flushPromises, mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setDashboardState } from '../../../../src/client/app/dashboard-state.ts';
import DevicesPanel from '../../../../src/client/features/devices/devices-panel.vue';
import { devicesStatus } from '../../../../src/client/features/devices/devices-status.ts';
import type { DashboardState, DeviceInfo } from '../../../../src/shared/types/index.ts';

const DAY_MS = 86_400_000;
const NOW = Date.now();

const phone: DeviceInfo = { id: 'd1', name: 'Phone', createdMs: NOW - 2 * DAY_MS, lastSeenMs: NOW - 5 * 60_000 };
const tablet: DeviceInfo = { id: 'd2', name: '<b>Tablet</b>', createdMs: NOW - DAY_MS, lastSeenMs: null };

function makeState(manageDevices: boolean): DashboardState {
  return {
    generatedAtMs: 1,
    projects: [],
    sessions: [],
    subagents: [],
    messages: [],
    usage: { days: [], totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, byModel: {} },
    limits: { source: 'none', fetchedAtMs: null, error: null, windows: [], hits: [] },
    recentSessions: [],
    features: { lan: true, commands: true, permissionModes: [], manageDevices },
    team: null,
    alerts: { items: [], threshold: 80 },
    permissions: [],
  };
}

interface FetchCall {
  path: string;
  body: unknown;
}

interface FakeReply {
  status: number;
  json: unknown;
}

let calls: FetchCall[] = [];
let devices: DeviceInfo[] = [];
let replies: Record<string, FakeReply> = {};

beforeEach(() => {
  calls = [];
  devices = [phone, tablet];
  replies = {};
  devicesStatus.value = '';
  vi.stubGlobal('fetch', async (path: string, init?: { body?: string }) => {
    calls.push({ path, body: init?.body ? JSON.parse(init.body) : undefined });
    const isList = path === '/api/devices' && !init?.body;
    const reply = (isList ? undefined : replies[path]) ?? (isList ? { status: 200, json: { devices } } : { status: 200, json: {} });
    return { ok: reply.status < 400, status: reply.status, json: async () => reply.json };
  });
  window.confirm = () => true;
});

// Every panel watches the one shared store, so a leftover mount would fetch on the next push.
const mounted: VueWrapper[] = [];

afterEach(() => {
  mounted.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.unstubAllGlobals();
});

async function mountShown(): Promise<VueWrapper> {
  setDashboardState(makeState(true));
  const wrapper = mount(DevicesPanel);
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

describe('DevicesPanel', () => {
  it('shows nothing and fetches nothing when this is not the PC', async () => {
    setDashboardState(makeState(false));
    const wrapper = mount(DevicesPanel);
    mounted.push(wrapper);
    await flushPromises();

    expect(wrapper.get('h2').text()).toBe('Devices');
    expect(wrapper.find('#devices-list').exists()).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('lists devices newest first with escaped names, created and last seen labels', async () => {
    const wrapper = await mountShown();

    const items = wrapper.findAll('.devices__item');
    expect(items).toHaveLength(2);
    expect(items[0]?.get('.devices__name').text()).toBe('<b>Tablet</b>');
    expect(wrapper.find('.devices__item b').exists()).toBe(false);
    expect(items[0]?.get('.sub').text()).toContain('Last seen never');
    expect(items[1]?.get('.sub').text()).toContain('Last seen 5m ago');
    expect(wrapper.find('[aria-label="Revoke Phone"]').exists()).toBe(true);
  });

  it('shows an empty note when there are no devices', async () => {
    devices = [];
    const wrapper = await mountShown();
    expect(wrapper.get('.empty').text()).toBe('No devices yet.');
  });

  it('re-fetches on a push only after 30 seconds', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      await mountShown();
      expect(calls.filter((call) => call.path === '/api/devices')).toHaveLength(1);

      setDashboardState(makeState(true));
      await flushPromises();
      expect(calls.filter((call) => call.path === '/api/devices')).toHaveLength(1);

      vi.setSystemTime(Date.now() + 31_000);
      setDashboardState(makeState(true));
      await flushPromises();
      expect(calls.filter((call) => call.path === '/api/devices')).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('adds a device, shows the token once, and clears it on Dismiss', async () => {
    const wrapper = await mountShown();
    replies = { '/api/devices': { status: 200, json: { id: 'd3', token: 'secret-token-value' } } };

    await wrapper.get('#devices-name').setValue('  Laptop ');
    await wrapper.get('#devices-form').trigger('submit');
    await flushPromises();

    expect(calls.some((call) => call.path === '/api/devices' && JSON.stringify(call.body) === '{"name":"Laptop"}')).toBe(true);
    expect(wrapper.get('#devices-token-value').text()).toBe('secret-token-value');
    expect(devicesStatus.value).toBe('Device added. Copy the token now; it is shown only once.');
    expect(wrapper.get<HTMLInputElement>('#devices-name').element.value).toBe('');

    await wrapper.get('#devices-token-dismiss').trigger('click');
    expect(wrapper.find('#devices-token').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('secret-token-value');
    expect(devicesStatus.value).toBe('');
  });

  it('copies the token to the clipboard', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const wrapper = await mountShown();
    replies = { '/api/devices': { status: 200, json: { id: 'd3', token: 'tok-1' } } };
    await wrapper.get('#devices-name').setValue('Laptop');
    await wrapper.get('#devices-form').trigger('submit');
    await flushPromises();

    await wrapper.get('#devices-token-copy').trigger('click');
    await flushPromises();

    expect(writeText).toHaveBeenCalledWith('tok-1');
    expect(devicesStatus.value).toBe('Copied.');
  });

  it('drops the token when the panel is hidden', async () => {
    const wrapper = await mountShown();
    replies = { '/api/devices': { status: 200, json: { id: 'd3', token: 'tok-2' } } };
    await wrapper.get('#devices-name').setValue('Laptop');
    await wrapper.get('#devices-form').trigger('submit');
    await flushPromises();
    expect(wrapper.find('#devices-token').exists()).toBe(true);

    setDashboardState(makeState(false));
    await flushPromises();
    expect(wrapper.find('#devices-token').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('tok-2');
    expect(wrapper.find('#devices-qr').exists()).toBe(false);

    setDashboardState(makeState(true));
    await flushPromises();
    expect(wrapper.find('#devices-token').exists()).toBe(false);
  });

  it('rejects an empty name without calling the server', async () => {
    const wrapper = await mountShown();
    const before = calls.length;
    await wrapper.get('#devices-name').setValue('   ');
    await wrapper.get('#devices-form').trigger('submit');
    await flushPromises();

    expect(devicesStatus.value).toBe('Enter a name of 1 to 40 characters.');
    expect(calls).toHaveLength(before);
  });

  it('revokes after a confirm and re-fetches; a declined confirm does nothing', async () => {
    const wrapper = await mountShown();
    const before = calls.length;

    window.confirm = () => false;
    await wrapper.get('[aria-label="Revoke Phone"]').trigger('click');
    await flushPromises();
    expect(calls).toHaveLength(before);

    window.confirm = () => true;
    await wrapper.get('[aria-label="Revoke Phone"]').trigger('click');
    await flushPromises();
    expect(calls.slice(before).map((call) => call.path)).toEqual(['/api/devices/revoke', '/api/devices']);
    expect(calls[before]?.body).toEqual({ id: 'd1' });
  });

  it('asks for a pairing code and shows the QR component', async () => {
    const info = { path: '/pair?c=abc', urls: [], expiresMs: NOW + 600_000 };
    const wrapper = await mountShown();
    replies = { '/api/devices/pair': { status: 200, json: info } };

    await wrapper.get('[aria-label="Show QR for Phone"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('#devices-qr-name').text()).toBe('Phone');
  });

  it('shows a known server error, and a generic text for an unknown one', async () => {
    const wrapper = await mountShown();
    replies = { '/api/devices/revoke': { status: 404, json: { error: 'unknown device' } } };
    await wrapper.get('[aria-label="Revoke Phone"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('#devices-status').text()).toBe('unknown device');

    replies = { '/api/devices/revoke': { status: 500, json: { error: 'ENOENT: C:\\secret\\devices.json' } } };
    await wrapper.get('[aria-label="Revoke Phone"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('#devices-status').text()).toBe('Something went wrong. Try again.');
  });
});
