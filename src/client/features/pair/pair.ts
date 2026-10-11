// External (not inline) so the page works under the Content-Security-Policy.
import { mountComponent } from '../../app/mount-component.ts';
import PairForm from './pair-form.vue';
import { isPairCodeValid } from './pair.logic.ts';

const HOST_ID = 'pair-app';

const host = document.getElementById(HOST_ID);
const code = new URLSearchParams(location.search).get('c') ?? '';

mountComponent(PairForm, HOST_ID, {
  isCodeValid: isPairCodeValid(host?.dataset.state),
  deviceName: host?.dataset.device ?? '',
  code,
  // Navigate from here (not a redirect ending a navigation started in another app), so the Strict cookie is sent.
  goHome: () => location.replace('/'),
});
