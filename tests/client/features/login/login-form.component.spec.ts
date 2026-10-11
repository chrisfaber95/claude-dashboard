import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import LoginForm from '../../../../src/client/features/login/login-form.vue';

describe('login form', () => {
  it('posts the token to /login with no error text by default', () => {
    const wrapper = mount(LoginForm, { props: { errorCode: null } });
    const form = wrapper.get('form');
    expect(form.attributes('method')).toBe('post');
    expect(form.attributes('action')).toBe('/login');
    const input = wrapper.get('input[name="token"]');
    expect(input.attributes('type')).toBe('password');
    expect(input.attributes('required')).toBeDefined();
    expect(wrapper.get('#err').text()).toBe('');
    expect(wrapper.get('button[type="submit"]').text()).toBe('Log in');
  });

  it.each([
    ['1', 'Wrong token.'],
    ['rate', 'Too many attempts. Wait a minute and try again.'],
    ['pair', 'This QR code was already used or has expired. Ask for a new one.'],
  ])('shows the text for error code %s', (code, text) => {
    const wrapper = mount(LoginForm, { props: { errorCode: code } });
    expect(wrapper.get('#err').text()).toBe(text);
    expect(wrapper.get('#err').attributes('role')).toBe('alert');
  });
});
