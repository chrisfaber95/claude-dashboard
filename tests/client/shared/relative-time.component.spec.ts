import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RelativeTime from '../../../src/client/shared/relative-time.vue';
import { tickTimes } from '../../../src/client/shared/time.ts';

const NOW_MS = Date.parse('2026-10-11T12:00:00Z');
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

describe('RelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a past time for kind ago', () => {
    const wrapper = mount(RelativeTime, { props: { kind: 'ago', timestampMs: NOW_MS - 3 * MINUTE_MS } });
    expect(wrapper.text()).toBe('3m ago');
    expect(wrapper.attributes('data-time')).toBe('ago');
    expect(wrapper.attributes('data-ms')).toBe(String(NOW_MS - 3 * MINUTE_MS));
  });

  it('shows the time left for kind until', () => {
    const wrapper = mount(RelativeTime, { props: { kind: 'until', timestampMs: NOW_MS + 2 * HOUR_MS + 5 * MINUTE_MS } });
    expect(wrapper.text()).toBe('resets in 2h 5m');
    expect(wrapper.attributes('data-time')).toBe('until');
  });

  it('shows the uptime for kind up', () => {
    const wrapper = mount(RelativeTime, { props: { kind: 'up', timestampMs: NOW_MS - HOUR_MS - 5 * MINUTE_MS } });
    expect(wrapper.text()).toBe('1h 5m');
    expect(wrapper.attributes('data-time')).toBe('up');
  });

  it('shows the fallback text and an empty data-ms for a null time', () => {
    const ago = mount(RelativeTime, { props: { kind: 'ago', timestampMs: null } });
    expect(ago.text()).toBe('—');
    expect(ago.attributes('data-ms')).toBe('');
    expect(mount(RelativeTime, { props: { kind: 'until', timestampMs: null } }).text()).toBe('no reset scheduled');
    expect(mount(RelativeTime, { props: { kind: 'up', timestampMs: null } }).text()).toBe('0m');
  });

  it('is advanced by tickTimes between pushes', () => {
    const wrapper = mount(RelativeTime, { props: { kind: 'ago', timestampMs: NOW_MS - MINUTE_MS } });
    document.body.append(wrapper.element);
    vi.setSystemTime(NOW_MS + 4 * MINUTE_MS);
    tickTimes();
    expect(wrapper.text()).toBe('5m ago');
    wrapper.element.remove();
  });
});
