import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { setOpenPopup, useOpenPopup } from '../../../../src/client/features/popups/open-popup.ts';
import OpenPopupProbe from './open-popup-probe.vue';

describe('open popup id', () => {
  afterEach(() => setOpenPopup(null));

  it('is null until a popup opens', () => {
    expect(useOpenPopup().value).toBeNull();
  });

  it('re-renders a reading component on open, switch and close', async () => {
    const wrapper = mount(OpenPopupProbe);
    expect(wrapper.text()).toBe('team is closed');

    setOpenPopup('team');
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toBe('team is open');

    setOpenPopup('usage');
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toBe('team is closed');

    setOpenPopup('team');
    await wrapper.vm.$nextTick();
    setOpenPopup(null);
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toBe('team is closed');
  });
});
