import type { PairingInfo } from '../../../shared/types/index.ts';
import { qrShape } from './qr.logic.ts';
import { elementById } from '../../shared/dom.ts';
import { devicesStatus } from './devices-status.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The pairing links live only in memory while the QR is shown; never in the DOM as text, storage or the console. */
let qrLinks: string[] = [];
let qrId = '';
let qrName = '';
let qrTimer: ReturnType<typeof setTimeout> | undefined;

/** Remove the QR drawing and forget the pairing links. */
export function clearQr(): void {
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

/** Draw one of the pairing links as an SVG QR code. */
export function drawQr(link: string): void {
  const draw = elementById('devices-qr-draw');
  let shape;
  try {
    shape = qrShape(link);
  } catch {
    draw.replaceChildren();
    setQrStatus('Could not draw the QR code.');
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

/** Show the QR code of a device; the caller clears the one-time token first. */
export function showQr(id: string, name: string, info: PairingInfo): void {
  clearQr();
  qrId = id;
  qrName = name;
  const hasLan = info.urls.length > 0;
  qrLinks = hasLan ? [...info.urls] : [location.origin + info.path];
  elementById('devices-qr-name').textContent = name;
  elementById('devices-qr-note').textContent = hasLan ? '' : 'No LAN address was found. The phone cannot reach this link unless it is opened from a LAN address.';
  const sel = elementById<HTMLSelectElement>('devices-qr-addr');
  if (qrLinks.length > 1) {
    qrLinks.forEach((link, index) => {
      let label = `Address ${index + 1}`;
      try {
        label = new URL(link).host; // host:port only, never the code
      } catch {
        /* keep the generic label */
      }
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = label;
      sel.append(option);
    });
    sel.hidden = false;
  }
  elementById('devices-qr-expiry').textContent = `Expires at ${new Date(info.expiresMs).toLocaleTimeString()}`;
  elementById('devices-qr').hidden = false;
  drawQr(qrLinks[0] ?? '');
  qrTimer = setTimeout(() => {
    clearQr();
    setQrStatus('The QR code expired.');
  }, Math.max(0, info.expiresMs - Date.now()));
}

function setQrStatus(text: string): void {
  devicesStatus.value = text;
}

/** Id of the device whose QR code is shown, or an empty string. */
export function shownQrDeviceId(): string {
  return qrId;
}

/** Redraw the QR code with another of the pairing links, by index. */
export function drawQrLink(index: number): void {
  const link = qrLinks[index];
  if (link !== undefined) drawQr(link);
}
