import type { DashboardState, DeviceInfo, PairingInfo } from '../../../shared/types/index.ts';
import { cleanName, createdLabel, lastSeenLabel, sortDevices } from './devices.logic.ts';
import { clearQr, drawQrLink, showQr, shownQrDeviceId } from './devices-qr.view.ts';
import { elementById } from '../../shared/dom.ts';
import { api, ApiError } from '../../shared/api.ts';
import { esc } from '../../shared/escape.ts';

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

let isVisible = false;
let lastFetchMs = 0;
let listHtml = '';
let isBusy = false;
let isLoading = false;
/** A refresh was asked for while one was in flight: run again once it ends, so the change just made shows. */
let shouldRefreshAgain = false;

function errText(err: unknown): string {
  return err instanceof ApiError && KNOWN_ERRORS.has(err.message) ? err.message : GENERIC_ERROR;
}

function setStatus(text: string): void {
  elementById('devices-status').textContent = text;
}

/** Remove the one-time token from the DOM; nothing else holds it. */
function clearToken(): void {
  elementById('devices-token-value').textContent = '';
  elementById('devices-token').hidden = true;
}

function setBusy(on: boolean): void {
  isBusy = on;
  for (const b of elementById('devices').querySelectorAll<HTMLButtonElement>('button')) {
    if (b.id === 'devices-token-dismiss' || b.id === 'devices-qr-close') continue;
    b.disabled = on;
  }
}

function row(device: DeviceInfo, now: number): string {
  return `<li class="devices__item">
    <div class="devices__text"><div class="devices__name">${esc(device.name)}</div><div class="sub">Added ${esc(createdLabel(device.createdMs))} · Last seen ${esc(lastSeenLabel(device.lastSeenMs, now))}</div></div>
    <div class="devices__actions"><button class="btn btn--sm" type="button" data-qr="${esc(device.id)}" aria-label="${esc(`Show QR for ${device.name}`)}">Show QR</button>
    <button class="btn btn--sm" type="button" data-revoke="${esc(device.id)}" aria-label="${esc(`Revoke ${device.name}`)}">Revoke</button></div></li>`;
}

async function refresh(): Promise<void> {
  if (isLoading) {
    shouldRefreshAgain = true;
    return;
  }
  isLoading = true;
  lastFetchMs = Date.now();
  try {
    const { devices } = await api<{ devices: DeviceInfo[] }>('/api/devices');
    if (!isVisible) return;
    const now = Date.now();
    const html = devices.length ? sortDevices(devices).map((device) => row(device, now)).join('') : '<li class="empty">No devices yet.</li>';
    if (html !== listHtml) {
      listHtml = html;
      elementById('devices-list').innerHTML = html;
      if (isBusy) setBusy(true);
    }
  } catch (err) {
    if (isVisible) setStatus(errText(err));
  } finally {
    isLoading = false;
    if (shouldRefreshAgain && isVisible) {
      shouldRefreshAgain = false;
      void refresh();
    }
    shouldRefreshAgain = false;
  }
}

/** Show the panel only for the PC; re-fetch the list on show and at most every 30 s while shown. */
export function renderDevices(state: DashboardState): void {
  const panel = elementById('devices');
  const shouldShow = state.features?.manageDevices === true;
  if (!shouldShow) {
    isVisible = false;
    panel.hidden = true;
    clearToken();
    clearQr();
    listHtml = '';
    elementById('devices-list').innerHTML = '';
    setStatus('');
    return;
  }
  const isFirstShow = !isVisible;
  isVisible = true;
  panel.hidden = false;
  if (isFirstShow || Date.now() - lastFetchMs >= REFRESH_MS) void refresh();
}

async function copyToken(): Promise<void> {
  try {
    await navigator.clipboard.writeText(elementById('devices-token-value').textContent ?? '');
    setStatus('Copied.');
  } catch {
    setStatus('Could not copy. Select the token and copy it by hand.');
  }
}

/** Submitting the name form adds a device and shows its one-time token. */
function wireAddForm(input: HTMLInputElement): void {
  elementById('devices-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (isBusy) return;
    const name = cleanName(input.value);
    if (name === null) {
      setStatus('Enter a name of 1 to 40 characters.');
      return;
    }
    clearToken();
    clearQr();
    setStatus('');
    setBusy(true);
    api<{ id: string; token: string }>('/api/devices', { name }).then(
      (created) => {
        // The panel may have been hidden while the request was in flight: then the token is dropped, not shown.
        if (!isVisible) {
          setBusy(false);
          return;
        }
        clearQr();
        elementById('devices-token-value').textContent = created.token;
        elementById('devices-token').hidden = false;
        input.value = '';
        setStatus('Device added. Copy the token now; it is shown only once.');
        setBusy(false);
        void refresh();
      },
      (error) => {
        setStatus(errText(error));
        setBusy(false);
      },
    );
  });
}

/** The token copy/dismiss buttons and the QR close button and address picker. */
function wireTokenAndQrControls(): void {
  elementById('devices-token-copy').addEventListener('click', () => void copyToken());
  elementById('devices-token-dismiss').addEventListener('click', () => {
    clearToken();
    setStatus('');
  });

  elementById('devices-qr-close').addEventListener('click', () => {
    clearQr();
    setStatus('');
  });
  elementById<HTMLSelectElement>('devices-qr-addr').addEventListener('change', (event) => {
    drawQrLink(Number((event.target as HTMLSelectElement).value));
  });
}

/** Name of the device a list button belongs to, as shown in its row. */
function deviceNameOf(button: HTMLElement): string {
  return button.closest('li')?.querySelector('.devices__name')?.textContent ?? 'this device';
}

function requestPairing(button: HTMLButtonElement): void {
  const id = button.dataset['qr'] ?? '';
  if (isBusy || !id) return;
  const name = deviceNameOf(button);
  clearQr();
  clearToken();
  setStatus('');
  setBusy(true);
  api<PairingInfo>('/api/devices/pair', { id }).then(
    (info) => {
      // Dropped, not drawn, when the panel was hidden while the request was in flight.
      if (isVisible) {
        clearToken();
        showQr(id, name, info);
      }
      setBusy(false);
    },
    (error) => {
      if (isVisible) setStatus(errText(error));
      setBusy(false);
    },
  );
}

function requestRevoke(button: HTMLButtonElement): void {
  if (isBusy) return;
  const name = deviceNameOf(button);
  if (!window.confirm(`Revoke "${name}"? It will be signed out and can no longer connect.`)) return;
  setStatus('');
  if (shownQrDeviceId() === button.dataset['revoke']) clearQr();
  setBusy(true);
  api('/api/devices/revoke', { id: button.dataset['revoke'] }).then(
    () => {
      setBusy(false);
      void refresh();
    },
    (error) => {
      setStatus(errText(error));
      setBusy(false);
      // A "saved failed" revoke may still have changed the list.
      void refresh();
    },
  );
}

/** Wire the add form, the token and QR controls, and the Show QR / Revoke buttons of the list. */
export function initDevices(): void {
  wireAddForm(elementById<HTMLInputElement>('devices-name'));
  wireTokenAndQrControls();

  elementById('devices-list').addEventListener('click', (event) => {
    const target = event.target as Element;
    const qrButton = target.closest<HTMLButtonElement>('[data-qr]');
    if (qrButton) {
      requestPairing(qrButton);
      return;
    }
    const revokeButton = target.closest<HTMLButtonElement>('[data-revoke]');
    if (revokeButton) requestRevoke(revokeButton);
  });
}
