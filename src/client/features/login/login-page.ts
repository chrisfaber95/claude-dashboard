// External (not inline) so the page works under the Content-Security-Policy.
import { mountComponent } from '../../app/mount-component.ts';
import LoginForm from './login-form.vue';

mountComponent(LoginForm, 'login-app', { errorCode: new URLSearchParams(location.search).get('e') });
