import type { DashboardState, DeviceInfo, PairingInfo } from '../../../shared/types/index.ts';
import { cleanName, createdLabel, lastSeenLabel, sortDevices } from './devices.logic.ts';
import { qrShape } from './qr.logic.ts';
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
  elementById('devices-status').textContent = text;
}

/** Remove the one-time token from the DOM; nothing else holds it. */
function clearToken(): void {
  elementById('devices-token-value').textContent = '';
  elementById('devices-token').hidden = true;
}

/** The pairing links live only in memory while the QR is shown; never in the DOM as text, storage or the console. */
let qrLinks: string[] = [];
let qrId = '';
let qrName = '';
let qrTimer: ReturnType<typeof setTimeout> | undefined;

/** Remove the QR drawing and forget the pairing links. */
function clearQr(): void {
  if (qrTimer !== undefined) clearTimeout(qrTimer);
  qrTimer = undefined;
  qrLinks = [];
  qrId = '';
  qrName = '';
  elementById('devices-qr-draw').replaceChildren();
  elementById('devices-qr-addr').replaceChildren();
  elementById('devices-qr-addr').hidden = true;
  elementById('devices-qr-name').textContent = '';
  elementById('devices-qr-expiry').textContent = '';
  elementById('devices-qr-note').textContent = '';
  elementById('devices-qr').hidden = true;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function drawQr(link: string): void {
  const draw = elementById('devices-qr-draw');
  let shape;
  try {
    shape = qrShape(link);
  } catch {
    draw.replaceChildren();
    setStatus('Could not draw the QR code.');
    return;
  }
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${shape.size} ${shape.size}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `QR code to sign in ${qrName}`);
  svg.classList.add('devices__qr-svg');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', shape.d);
  svg.append(path);
  draw.replaceChildren(svg);
}

function showQr(id: string, name: string, info: PairingInfo): void {
  clearQr();
  clearToken();
  qrId = id;
  qrName = name;
  const lan = info.urls.length > 0;
  qrLinks = lan ? [...info.urls] : [location.origin + info.path];
  elementById('devices-qr-name').textContent = name;
  elementById('devices-qr-note').textContent = lan ? '' : 'No LAN address was found. The phone cannot reach this link unless it is opened from a LAN address.';
  const sel = elementById<HTMLSelectElement>('devices-qr-addr');
  if (qrLinks.length > 1) {
    qrLinks.forEach((u, i) => {
      let label = `Address ${i + 1}`;
      try {
        label = new URL(u).host; // host:port only, never the code
      } catch {
        /* keep the generic label */
      }
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = label;
      sel.append(o);
    });
    sel.hidden = false;
  }
  elementById('devices-qr-expiry').textContent = `Expires at ${new Date(info.expiresMs).toLocaleTimeString()}`;
  elementById('devices-qr').hidden = false;
  drawQr(qrLinks[0] ?? '');
  qrTimer = setTimeout(() => {
    clearQr();
    setStatus('The QR code expired.');
  }, Math.max(0, info.expiresMs - Date.now()));
}

function setBusy(on: boolean): void {
  busy = on;
  for (const b of elementById('devices').querySelectorAll<HTMLButtonElement>('button')) {
    if (b.id === 'devices-token-dismiss' || b.id === 'devices-qr-close') continue;
    b.disabled = on;
  }
}

function row(d: DeviceInfo, now: number): string {
  return `<li class="devices__item">
    <div class="devices__text"><div class="devices__name">${esc(d.name)}</div><div class="sub">Added ${esc(createdLabel(d.createdMs))} · Last seen ${esc(lastSeenLabel(d.lastSeenMs, now))}</div></div>
    <div class="devices__actions"><button class="btn btn--sm" type="button" data-qr="${esc(d.id)}" aria-label="${esc(`Show QR for ${d.name}`)}">Show QR</button>
    <button class="btn btn--sm" type="button" data-revoke="${esc(d.id)}" aria-label="${esc(`Revoke ${d.name}`)}">Revoke</button></div></li>`;
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
      elementById('devices-list').innerHTML = html;
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
  const panel = elementById('devices');
  const show = s.features?.manageDevices === true;
  if (!show) {
    visible = false;
    panel.hidden = true;
    clearToken();
    clearQr();
    listHtml = '';
    elementById('devices-list').innerHTML = '';
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
    await navigator.clipboard.writeText(elementById('devices-token-value').textContent ?? '');
    setStatus('Copied.');
  } catch {
    setStatus('Could not copy. Select the token and copy it by hand.');
  }
}

export function initDevices(): void {
  const input = elementById<HTMLInputElement>('devices-name');

  elementById('devices-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (busy) return;
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
      (res) => {
        // The panel may have been hidden while the request was in flight: then the token is dropped, not shown.
        if (!visible) {
          setBusy(false);
          return;
        }
        clearQr();
        elementById('devices-token-value').textContent = res.token;
        elementById('devices-token').hidden = false;
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

  elementById('devices-token-copy').addEventListener('click', () => void copyToken());
  elementById('devices-token-dismiss').addEventListener('click', () => {
    clearToken();
    setStatus('');
  });

  elementById('devices-qr-close').addEventListener('click', () => {
    clearQr();
    setStatus('');
  });
  elementById<HTMLSelectElement>('devices-qr-addr').addEventListener('change', (e) => {
    const i = Number((e.target as HTMLSelectElement).value);
    const link = qrLinks[i];
    if (link !== undefined) drawQr(link);
  });

  elementById('devices-list').addEventListener('click', (e) => {
    const target = e.target as Element;
    const q = target.closest<HTMLButtonElement>('[data-qr]');
    if (q) {
      const id = q.dataset['qr'] ?? '';
      if (busy || !id) return;
      const name = q.closest('li')?.querySelector('.devices__name')?.textContent ?? 'this device';
      clearQr();
      clearToken();
      setStatus('');
      setBusy(true);
      api<PairingInfo>('/api/devices/pair', { id }).then(
        (info) => {
          // Dropped, not drawn, when the panel was hidden while the request was in flight.
          if (visible) showQr(id, name, info);
          setBusy(false);
        },
        (err) => {
          if (visible) setStatus(errText(err));
          setBusy(false);
        },
      );
      return;
    }
    const b = target.closest<HTMLButtonElement>('[data-revoke]');
    if (!b || busy) return;
    const name = b.closest('li')?.querySelector('.devices__name')?.textContent ?? 'this device';
    if (!window.confirm(`Revoke "${name}"? It will be signed out and can no longer connect.`)) return;
    setStatus('');
    if (qrId === b.dataset['revoke']) clearQr();
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
