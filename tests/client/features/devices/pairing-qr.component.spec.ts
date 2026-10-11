import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PairingQr from '../../../../src/client/features/devices/pairing-qr.vue';
import type { PairingInfo } from '../../../../src/shared/types/index.ts';

const TEN_MINUTES_MS = 600_000;
const LINK_A = `https://192.168.1.50:4777/pair?c=${'A'.repeat(43)}`;
const LINK_B = `https://10.0.0.7:4777/pair?c=${'B'.repeat(43)}`;

function makeInfo(overrides: Partial<PairingInfo> = {}): PairingInfo {
  return { path: '/pair?c=abc', urls: [LINK_A], expiresMs: Date.now() + TEN_MINUTES_MS, ...overrides };
}

describe('PairingQr', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the device name, the expiry text and a drawn QR code', async () => {
    const info = makeInfo();
    const wrapper = mount(PairingQr, { props: { deviceName: 'Phone', info } });
    await vi.dynamicImportSettled();
    await flushPromises();

    expect(wrapper.get('#devices-qr-name').text()).toBe('Phone');
    expect(wrapper.get('#devices-qr-expiry').text()).toBe(`Expires at ${new Date(info.expiresMs).toLocaleTimeString()}`);
    expect(wrapper.get('#devices-qr-note').text()).toBe('');
    expect(wrapper.find('#devices-qr-addr').exists()).toBe(false);
    const svg = wrapper.get('svg.devices__qr-svg');
    expect(svg.attributes('aria-label')).toBe('QR code to sign in Phone');
    expect(svg.get('path').attributes('d')).toContain('h1v1h-1z');
    wrapper.unmount();
  });

  it('warns when there is no LAN address and falls back to the page origin', async () => {
    const wrapper = mount(PairingQr, { props: { deviceName: 'Phone', info: makeInfo({ urls: [] }) } });
    await vi.dynamicImportSettled();
    await flushPromises();

    expect(wrapper.get('#devices-qr-note').text()).toContain('No LAN address was found');
    expect(wrapper.find('svg').exists()).toBe(true);
    wrapper.unmount();
  });

  it('offers the addresses by host and redraws when another one is picked', async () => {
    const wrapper = mount(PairingQr, { props: { deviceName: 'Phone', info: makeInfo({ urls: [LINK_A, LINK_B] }) } });
    await vi.dynamicImportSettled();
    await flushPromises();
    const before = wrapper.get('path').attributes('d');

    const options = wrapper.findAll('#devices-qr-addr option').map((option) => option.text());
    expect(options).toEqual(['192.168.1.50:4777', '10.0.0.7:4777']);
    expect(wrapper.html()).not.toContain('A'.repeat(43));
    await wrapper.get('#devices-qr-addr').setValue(1);
    await flushPromises();

    expect(wrapper.get('path').attributes('d')).not.toBe(before);
    wrapper.unmount();
  });

  it('emits close from the Close button', async () => {
    const wrapper = mount(PairingQr, { props: { deviceName: 'Phone', info: makeInfo() } });
    await wrapper.get('#devices-qr-close').trigger('click');

    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });

  it('emits expired when the code runs out, and not after unmount', async () => {
    const wrapper = mount(PairingQr, { props: { deviceName: 'Phone', info: makeInfo() } });
    vi.advanceTimersByTime(TEN_MINUTES_MS - 1);
    expect(wrapper.emitted('expired')).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(wrapper.emitted('expired')).toHaveLength(1);
    wrapper.unmount();

    const other = mount(PairingQr, { props: { deviceName: 'Phone', info: makeInfo() } });
    other.unmount();
    vi.advanceTimersByTime(TEN_MINUTES_MS);
    expect(other.emitted('expired')).toBeUndefined();
  });
});
