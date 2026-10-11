import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import Tooltip from '../../../../src/client/features/tooltip/tooltip.vue';

function addTarget(tipText: string): HTMLElement {
  const target = document.createElement('span');
  target.setAttribute('data-tip', tipText);
  document.body.append(target);
  return target;
}

function moveOver(target: Element, clientX: number, clientY: number): void {
  target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX, clientY }));
}

describe('Tooltip', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('shows the data-tip text as text, never as HTML', async () => {
    const wrapper = mount(Tooltip);
    const target = addTarget('<b>bold</b>\nsecond line');
    expect(wrapper.element.hasAttribute('hidden')).toBe(true);

    moveOver(target, 10, 20);
    await flushPromises();

    expect(wrapper.element.hasAttribute('hidden')).toBe(false);
    expect(wrapper.element.textContent).toBe('<b>bold</b>\nsecond line');
    expect(wrapper.element.querySelector('b')).toBeNull();
    wrapper.unmount();
  });

  it('follows the pointer and hides when it leaves a tip element', async () => {
    const wrapper = mount(Tooltip);
    const target = addTarget('hello');
    const outside = document.createElement('div');
    document.body.append(outside);

    moveOver(target, 100, 50);
    await flushPromises();
    const tooltip = wrapper.element;
    if (!(tooltip instanceof HTMLElement)) throw new Error('tooltip root is not an element');
    expect(tooltip.style.left).toBe('114px');
    expect(tooltip.style.top).toBe('64px');

    moveOver(target, 200, 80);
    await flushPromises();
    expect(tooltip.style.left).toBe('214px');
    expect(tooltip.style.top).toBe('94px');

    moveOver(outside, 5, 5);
    await flushPromises();
    expect(tooltip.hasAttribute('hidden')).toBe(true);
    wrapper.unmount();
  });

  it('removes its document listener on unmount', async () => {
    const wrapper = mount(Tooltip);
    const target = addTarget('hello');
    const tooltip = wrapper.element;
    wrapper.unmount();

    moveOver(target, 1, 1);
    await flushPromises();
    expect(tooltip.textContent).toBe('');
  });
});
