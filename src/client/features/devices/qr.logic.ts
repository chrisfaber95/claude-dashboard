// QR code geometry (no DOM): testable with node --test. The drawing lives in devices.ts.
import qrcode from 'qrcode-generator';

/** Quiet zone around the code, in modules (the QR standard asks for 4). */
export const QR_MARGIN = 4;

/** Geometry of one QR code drawing. */
export interface QrShape {
  /** Width and height of the drawing in modules, margin included. */
  size: number;
  /** One SVG path: a 1x1 square for every dark module. */
  d: string;
}

/**
 * The QR code for `text` as an SVG path. Error correction M, smallest version that fits. Throws when the text is too
 * long for a QR code. Callers must only pass the pairing link, never a device token.
 */
export function qrShape(text: string): QrShape {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const moduleCount = qr.getModuleCount();
  let pathData = '';
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (qr.isDark(row, col)) pathData += `M${col + QR_MARGIN} ${row + QR_MARGIN}h1v1h-1z`;
    }
  }
  return { size: moduleCount + 2 * QR_MARGIN, d: pathData };
}
