// Fonts are served with their content type and exact bytes, and traversal is refused.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { makeFixture } from '../helpers.ts';

const fx = makeFixture();
const publicDir = join(fx.root, 'public');
mkdirSync(join(publicDir, 'fonts'), { recursive: true });
const fontBytes = Buffer.from([0x77, 0x4f, 0x46, 0x32, 0x00, 0xff, 0x10, 0x80, 0x7f]);
writeFileSync(join(publicDir, 'fonts', 'test.woff2'), fontBytes);
writeFileSync(join(fx.root, 'package.json'), '{"name":"outside"}');

const { createDashboardServer } = await import('../../src/server/server.ts');
const server = createDashboardServer({ publicDir });

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
});
after(() => {
  server.closeAllConnections();
  server.close();
});

/** Raw GET (binary-safe) so path traversal isn't normalised away by a URL parser. */
function rawGet(path: string): Promise<{ status: number; type: string; body: Buffer }> {
  const { port } = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type']), body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('serves a woff2 font with its content type and exact bytes', async () => {
  const response = await rawGet('/fonts/test.woff2');
  assert.equal(response.status, 200);
  assert.equal(response.type, 'font/woff2');
  assert.ok(response.body.equals(fontBytes));
});

test('traversal out of the fonts folder is refused', async () => {
  for (const path of ['/fonts/../../package.json', '/fonts/%2e%2e/%2e%2e/package.json', '/fonts/..%5c..%5cpackage.json']) {
    const response = await rawGet(path);
    assert.ok(!response.body.toString().includes('outside'), path);
    assert.ok([403, 404].includes(response.status), `${path} -> ${response.status}`);
  }
});
