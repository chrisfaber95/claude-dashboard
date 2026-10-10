import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ClickCounter from './click-counter.vue';

describe('ClickCounter', () => {
  it('renders its label and count', () => {
    const wrapper = mount(ClickCounter, { props: { label: 'Sessions' } });

    expect(wrapper.text()).toBe('Sessions: 0');
  });

  it('shows the new count after a click', async () => {
    const wrapper = mount(ClickCounter, { props: { label: 'Sessions' } });

    await wrapper.trigger('click');

    expect(wrapper.text()).toBe('Sessions: 1');
  });
});
