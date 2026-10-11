import { flushPromises, mount as mountComponent } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setOpenPopup } from '../../../../src/client/features/popups/open-popup.ts';
import AuditPanel from '../../../../src/client/features/audit/audit-panel.vue';
import type { AuditEntry } from '../../../../src/shared/types/index.ts';

const entries: AuditEntry[] = [
  { ts: '2026-10-11T10:00:00Z', action: 'start', device: 'Phone', deviceId: 'phone', project: 'alpha', ok: true, prompt: 'Fix the <b>bug</b>' },
  { ts: '2026-10-11T09:00:00Z', action: 'stop', device: 'This PC', deviceId: 'pc', session: '1234567890abcdef', ok: false },
];

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('AuditPanel', () => {
  // Every panel watches the shared open-popup ref, so a panel left mounted would load again in later tests.
  const mounted: VueWrapper[] = [];
  const mount = () => {
    const wrapper = mountComponent(AuditPanel);
    mounted.push(wrapper);
    return wrapper;
  };
  const fetchMock = vi.fn<(path: string) => Promise<Response>>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    setOpenPopup(null);
    vi.unstubAllGlobals();
  });

  it('loads nothing while the popup is closed and loads the log when it opens', async () => {
    fetchMock.mockResolvedValue(respond(200, { entries }));
    const wrapper = mount();
    expect(fetchMock).not.toHaveBeenCalled();

    setOpenPopup('audit');
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/audit');
    const items = wrapper.findAll('.audit__item');
    expect(items).toHaveLength(2);
    expect(items[0]?.get('.audit__device').text()).toBe('Phone');
    expect(items[0]?.get('.audit__action').text()).toBe('Started a task');
    expect(items[0]?.get('.audit__target').text()).toBe('alpha');
    expect(items[0]?.get('.audit__result--ok').text()).toBe('ok');
    expect(items[0]?.get('.audit__prompt').text()).toBe('Fix the <b>bug</b>');
    expect(wrapper.find('.audit__prompt b').exists()).toBe(false);
    expect(items[1]?.get('.audit__target').text()).toBe('12345678');
    expect(items[1]?.classes()).toContain('audit__item');
    expect(wrapper.findAll('.audit__result--failed')).toHaveLength(1);
    expect(wrapper.get('#audit-status').text()).toBe('');
    const options = wrapper.findAll('option').map((option) => option.text());
    expect(options).toEqual(['All devices', 'Phone', 'This PC']);
  });

  it('reloads with the chosen device and keeps the device choices', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { entries }));
    setOpenPopup('audit');
    const wrapper = mount();
    await flushPromises();

    fetchMock.mockResolvedValueOnce(respond(200, { entries: [entries[0]] }));
    await wrapper.get('#audit-device').setValue('phone');
    await flushPromises();

    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/audit?device=phone');
    expect(wrapper.findAll('.audit__item')).toHaveLength(1);
    expect(wrapper.findAll('option')).toHaveLength(3);
  });

  it('reloads on Refresh and shows an empty note when there is no activity', async () => {
    fetchMock.mockResolvedValue(respond(200, { entries: [] }));
    setOpenPopup('audit');
    const wrapper = mount();
    await flushPromises();
    expect(wrapper.get('.empty').text()).toBe('No activity yet.');

    await wrapper.get('#audit-refresh').trigger('click');
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shows an allow-listed server error and clears the rows', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { entries }));
    setOpenPopup('audit');
    const wrapper = mount();
    await flushPromises();

    fetchMock.mockResolvedValueOnce(respond(500, { error: 'could not read the audit log' }));
    await wrapper.get('#audit-refresh').trigger('click');
    await flushPromises();

    expect(wrapper.get('#audit-status').text()).toBe('could not read the audit log');
    expect(wrapper.findAll('.audit__item')).toHaveLength(0);
    expect(wrapper.find('.empty').exists()).toBe(false);
  });

  it('replaces any other error text with the generic message', async () => {
    fetchMock.mockResolvedValue(respond(500, { error: 'secret path N:/x/y' }));
    setOpenPopup('audit');
    const wrapper = mount();
    await flushPromises();

    expect(wrapper.get('#audit-status').text()).toBe('Could not load the activity.');
    expect(wrapper.text()).not.toContain('secret');
  });
});
