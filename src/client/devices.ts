import type { DashboardState, DeviceInfo } from '../shared/types.ts';
import { cleanName, createdLabel, lastSeenLabel, sortDevices } from './devices-logic.ts';
import { $, api, ApiError, esc } from './util.ts';

const REFRESH_MS = 30_000;
// Only these server strings may reach the page; anything else becomes the generic message.
const KNOWN_ERRORS = new Set([
  'invalid device name',
  'at most 100 devices',
  'unknown device',
  'could not save the device',
  'device revoked, but the change could not be saved',
]);
const GENERIC_ERROR = 'Something went wrong. Try again.';

let visible = false;
let lastFetchMs = 0;
let listHtml = '';
let busy = false;
let loading = false;
/** A refresh was asked for while one was in flight: run again once it ends, so the change just made shows. */
let again = false;

function errText(err: unknown): string {
  return err instanceof ApiError && KNOWN_ERRORS.has(err.message) ? err.message : GENERIC_ERROR;
}

function setStatus(text: string): void {
  $('devices-status').textContent = text;
}

/** Remove the one-time token from the DOM; nothing else holds it. */
function clearToken(): void {
  $('devices-token-value').textContent = '';
  $('devices-token').hidden = true;
}

function setBusy(on: boolean): void {
  busy = on;
  for (const b of $('devices').querySelectorAll<HTMLButtonElement>('button')) {
    if (b.id === 'devices-token-dismiss') continue;
    b.disabled = on;
  }
}

function row(d: DeviceInfo, now: number): string {
  return `<li class="devices__item">
    <div class="devices__text"><div class="devices__name">${esc(d.name)}</div><div class="sub">Added ${esc(createdLabel(d.createdMs))} · Last seen ${esc(lastSeenLabel(d.lastSeenMs, now))}</div></div>
    <button class="btn btn--sm" type="button" data-revoke="${esc(d.id)}" aria-label="${esc(`Revoke ${d.name}`)}">Revoke</button></li>`;
}

async function refresh(): Promise<void> {
  if (loading) {
    again = true;
    return;
  }
  loading = true;
  lastFetchMs = Date.now();
  try {
    const { devices } = await api<{ devices: DeviceInfo[] }>('/api/devices');
    if (!visible) return;
    const now = Date.now();
    const html = devices.length ? sortDevices(devices).map((d) => row(d, now)).join('') : '<li class="empty">No devices yet.</li>';
    if (html !== listHtml) {
      listHtml = html;
      $('devices-list').innerHTML = html;
      if (busy) setBusy(true);
    }
  } catch (err) {
    if (visible) setStatus(errText(err));
  } finally {
    loading = false;
    if (again && visible) {
      again = false;
      void refresh();
    }
    again = false;
  }
}

/** Show the panel only for the PC; re-fetch the list on show and at most every 30 s while shown. */
export function renderDevices(s: DashboardState): void {
  const panel = $('devices');
  const show = s.features?.manageDevices === true;
  if (!show) {
    visible = false;
    panel.hidden = true;
    clearToken();
    listHtml = '';
    $('devices-list').innerHTML = '';
    setStatus('');
    return;
  }
  const justShown = !visible;
  visible = true;
  panel.hidden = false;
  if (justShown || Date.now() - lastFetchMs >= REFRESH_MS) void refresh();
}

async function copyToken(): Promise<void> {
  try {
    await navigator.clipboard.writeText($('devices-token-value').textContent ?? '');
    setStatus('Copied.');
  } catch {
    setStatus('Could not copy. Select the token and copy it by hand.');
  }
}

export function initDevices(): void {
  const input = $<HTMLInputElement>('devices-name');

  $('devices-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (busy) return;
    const name = cleanName(input.value);
    if (name === null) {
      setStatus('Enter a name of 1 to 40 characters.');
      return;
    }
    clearToken();
    setStatus('');
    setBusy(true);
    api<{ id: string; token: string }>('/api/devices', { name }).then(
      (res) => {
        // The panel may have been hidden while the request was in flight: then the token is dropped, not shown.
        if (!visible) {
          setBusy(false);
          return;
        }
        $('devices-token-value').textContent = res.token;
        $('devices-token').hidden = false;
        input.value = '';
        setStatus('Device added. Copy the token now; it is shown only once.');
        setBusy(false);
        void refresh();
      },
      (err) => {
        setStatus(errText(err));
        setBusy(false);
      },
    );
  });

  $('devices-token-copy').addEventListener('click', () => void copyToken());
  $('devices-token-dismiss').addEventListener('click', () => {
    clearToken();
    setStatus('');
  });

  $('devices-list').addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-revoke]');
    if (!b || busy) return;
    const name = b.closest('li')?.querySelector('.devices__name')?.textContent ?? 'this device';
    if (!window.confirm(`Revoke "${name}"? It will be signed out and can no longer connect.`)) return;
    setStatus('');
    setBusy(true);
    api('/api/devices/revoke', { id: b.dataset['revoke'] }).then(
      () => {
        setBusy(false);
        void refresh();
      },
      (err) => {
        setStatus(errText(err));
        setBusy(false);
        // A "saved failed" revoke may still have changed the list.
        void refresh();
      },
    );
  });
}
