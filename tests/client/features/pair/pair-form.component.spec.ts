import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PairForm from '../../../../src/client/features/pair/pair-form.vue';

function mountForm(isCodeValid: boolean, goHome: () => void = () => undefined) {
  return mount(PairForm, { props: { isCodeValid, deviceName: '<b>Phone</b>', code: 'abc', goHome } });
}

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PairForm', () => {
  it('shows the escaped device name and posts the code, then goes home', async () => {
    const fetchMock = stubFetch(200, { ok: true });
    const goHome = vi.fn();
    const wrapper = mountForm(true, goHome);
    expect(wrapper.get('#ask').text()).toBe('Sign in as <b>Phone</b>?');
    expect(wrapper.find('#ask strong b').exists()).toBe(false);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/pair');
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin' });
    expect(String(init?.body)).toBe('c=abc');
    expect(goHome).toHaveBeenCalledOnce();
  });

  it('shows the rate-limit text on 429 and lets the user retry', async () => {
    stubFetch(429, { error: 'too many attempts' });
    const goHome = vi.fn();
    const wrapper = mountForm(true, goHome);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('#err').text()).toBe('Too many attempts. Wait a minute and try again.');
    expect(wrapper.get('#go').attributes('disabled')).toBeUndefined();
    expect(goHome).not.toHaveBeenCalled();
  });

  it('shows the expired text on 401 and when a 200 body is not { ok: true }', async () => {
    stubFetch(401, { error: 'invalid or used code' });
    const wrapper = mountForm(true);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('#err').text()).toContain('already used or has expired');

    stubFetch(200, 'nope');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('#err').text()).toContain('already used or has expired');
  });

  it('shows the unreachable text when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    const wrapper = mountForm(true);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('#err').text()).toBe('Could not reach the dashboard. Try again.');
  });

  it('offers no button for a code the server rejected', () => {
    const wrapper = mountForm(false);
    expect(wrapper.find('#go').exists()).toBe(false);
    expect(wrapper.find('#ask').exists()).toBe(false);
    expect(wrapper.get('#err').text()).toContain('already used or has expired');
  });
});
