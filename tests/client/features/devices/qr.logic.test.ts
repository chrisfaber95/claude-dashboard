// Pairing QR code geometry: size, quiet zone, finder patterns and plain path output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QR_MARGIN, qrShape } from '../../../../src/client/features/devices/qr.logic.ts';

const URL_A = 'https://192.168.1.50:4777/pair?c=' + 'A'.repeat(43);
const URL_B = 'https://192.168.1.50:4777/pair?c=' + 'B'.repeat(43);

/** The set of dark modules as "col,row" keys, read back from the path. */
function modules(pathData: string): Set<string> {
  const out = new Set<string>();
  for (const match of pathData.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) out.add(`${match[1]},${match[2]}`);
  return out;
}

test('qrShape is square, has a 4-module quiet zone and is deterministic', () => {
  const shape = qrShape(URL_A);
  assert.deepEqual(shape, qrShape(URL_A));
  assert.notEqual(shape.d, qrShape(URL_B).d);
  // version 1 is 21 modules; a link of this length needs a bigger one, always 21 + 4k
  assert.equal((shape.size - 2 * QR_MARGIN - 21) % 4, 0);
  assert.ok(shape.size - 2 * QR_MARGIN >= 21);
  const dark = modules(shape.d);
  assert.ok(dark.size > 100);
  for (const moduleKey of dark) {
    const [column, row] = moduleKey.split(',').map(Number);
    assert.ok(column >= QR_MARGIN && column < shape.size - QR_MARGIN && row >= QR_MARGIN && row < shape.size - QR_MARGIN, `module ${moduleKey} inside the code, not in the quiet zone`);
  }
});

test('the three finder patterns are present: a 7x7 dark ring with a 3x3 dark centre', () => {
  const { size, d: pathData } = qrShape(URL_A);
  const dark = modules(pathData);
  const codeSize = size - 2 * QR_MARGIN;
  for (const [ox, oy] of [
    [0, 0],
    [codeSize - 7, 0],
    [0, codeSize - 7],
  ]) {
    for (let i = 0; i < 7; i++) {
      for (let j = 0; j < 7; j++) {
        const isRing = i === 0 || i === 6 || j === 0 || j === 6;
        const isCentre = i >= 2 && i <= 4 && j >= 2 && j <= 4;
        const key = `${ox + i + QR_MARGIN},${oy + j + QR_MARGIN}`;
        assert.equal(dark.has(key), isRing || isCentre, `finder at ${ox},${oy} cell ${i},${j}`);
      }
    }
  }
});

test('the path is plain geometry: no markup, no text from the input', () => {
  const { d: pathData } = qrShape(URL_A);
  assert.match(pathData, /^(M\d+ \d+h1v1h-1z)+$/);
  assert.ok(!pathData.includes('pair') && !pathData.includes('A'.repeat(5)));
});

test('text that is too long for a QR code throws instead of drawing something wrong', () => {
  assert.throws(() => qrShape('x'.repeat(5000)));
});
