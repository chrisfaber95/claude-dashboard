import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, h, ref } from 'vue';

// Sample component test (T-060): the component is defined here with `h()`, so no `.vue` file is needed yet.

const clickCounter = defineComponent({
  props: { label: { type: String, required: true } },
  setup(props) {
    const count = ref(0);
    return () => h('button', { onClick: () => { count.value += 1; } }, `${props.label}: ${count.value}`);
  },
});

describe('ClickCounter', () => {
  it('renders its label and count', () => {
    const wrapper = mount(clickCounter, { props: { label: 'Sessions' } });

    expect(wrapper.text()).toBe('Sessions: 0');
  });

  it('shows the new count after a click', async () => {
    const wrapper = mount(clickCounter, { props: { label: 'Sessions' } });

    await wrapper.trigger('click');

    expect(wrapper.text()).toBe('Sessions: 1');
  });
});
