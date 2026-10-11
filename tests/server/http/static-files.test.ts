// Static files: gzip when accepted, immutable caching of hashed build assets only, guards unchanged.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { makeFixture } from '../../helpers.ts';

const fx = makeFixture();
const publicDir = join(fx.root, 'public');
mkdirSync(join(publicDir, 'assets'), { recursive: true });
mkdirSync(join(publicDir, 'fonts'), { recursive: true });
const scriptText = 'console.log("dashboard");\n'.repeat(200);
const fontBytes = Buffer.from([0x77, 0x4f, 0x46, 0x32, 0x00, 0xff]);
writeFileSync(join(publicDir, 'assets', 'index-AbC123_-.js'), scriptText);
writeFileSync(join(publicDir, 'login.js'), scriptText);
writeFileSync(join(publicDir, 'style.css'), 'body{color:red}\n'.repeat(100));
writeFileSync(join(publicDir, 'index.html'), '<!doctype html><title>x</title>\n'.repeat(50));
writeFileSync(join(publicDir, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n'.repeat(50));
writeFileSync(join(publicDir, 'fonts', 'test.woff2'), fontBytes);
writeFileSync(join(fx.root, 'package.json'), '{"name":"outside"}');

const { createDashboardServer } = await import('../../../src/server/server.ts');
const { acceptsGzip, cacheControlFor } = await import('../../../src/server/http/static-files.ts');
const server = createDashboardServer({ publicDir });

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
});
after(() => {
  server.closeAllConnections();
  server.close();
});

interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

/** Raw GET (binary-safe, no automatic decompression) with optional Accept-Encoding. */
function rawGet(path: string, acceptEncoding?: string): Promise<RawResponse> {
  const address = server.address();
  if (typeof address !== 'object' || address === null) throw new Error('server is not listening');
  const { port } = address;
  const headers: Record<string, string> = acceptEncoding === undefined ? {} : { 'Accept-Encoding': acceptEncoding };
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('js, css, html and svg are gzipped when the client accepts gzip', async () => {
  for (const path of ['/assets/index-AbC123_-.js', '/style.css', '/', '/logo.svg']) {
    const response = await rawGet(path, 'gzip, deflate, br');
    assert.equal(response.status, 200, path);
    assert.equal(response.headers['content-encoding'], 'gzip', path);
    assert.equal(response.headers['vary'], 'Accept-Encoding', path);
    assert.ok(gunzipSync(response.body).length > response.body.length, path);
  }
});

test('the gzipped body decompresses to the file', async () => {
  const response = await rawGet('/login.js', 'gzip');
  assert.equal(gunzipSync(response.body).toString(), scriptText);
  assert.equal(response.headers['content-type'], 'application/javascript; charset=utf-8');
});

test('clients without gzip get the plain file, still marked Vary', async () => {
  for (const acceptEncoding of [undefined, 'identity', 'gzip;q=0']) {
    const response = await rawGet('/login.js', acceptEncoding);
    assert.equal(response.headers['content-encoding'], undefined, String(acceptEncoding));
    assert.equal(response.headers['vary'], 'Accept-Encoding');
    assert.equal(response.body.toString(), scriptText);
  }
});

test('other types are never compressed', async () => {
  const response = await rawGet('/fonts/test.woff2', 'gzip');
  assert.equal(response.headers['content-encoding'], undefined);
  assert.equal(response.headers['vary'], undefined);
  assert.ok(response.body.equals(fontBytes));
});

test('only hashed build assets are cached immutably', async () => {
  const hashed = await rawGet('/assets/index-AbC123_-.js');
  assert.equal(hashed.headers['cache-control'], 'private, max-age=31536000, immutable');
  for (const path of ['/', '/login.js', '/style.css', '/logo.svg']) {
    assert.equal((await rawGet(path)).headers['cache-control'], undefined, path);
  }
});

test('security headers stay on compressed and cached responses', async () => {
  const response = await rawGet('/assets/index-AbC123_-.js', 'gzip');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['x-frame-options'], 'DENY');
  assert.equal(response.headers['referrer-policy'], 'same-origin');
  assert.ok(response.headers['content-security-policy']);
});

test('traversal is still refused with gzip accepted', async () => {
  for (const path of ['/assets/../../package.json', '/assets/%2e%2e/%2e%2e/package.json', '/assets/..%5c..%5cpackage.json']) {
    const response = await rawGet(path, 'gzip');
    assert.ok(!gunzipSyncSafe(response.body).includes('outside'), path);
    assert.ok([403, 404].includes(response.status), `${path} -> ${response.status}`);
  }
});

test('acceptsGzip reads the header like a browser sends it', () => {
  assert.equal(acceptsGzip('gzip, deflate, br'), true);
  assert.equal(acceptsGzip('GZIP;q=0.5'), true);
  assert.equal(acceptsGzip('gzip;q=0'), false);
  assert.equal(acceptsGzip('br, identity'), false);
  assert.equal(acceptsGzip(undefined), false);
});

test('cacheControlFor needs the assets folder and an 8 character hash', () => {
  assert.ok(cacheControlFor('/assets/index-AbC123_-.js'));
  assert.equal(cacheControlFor('/assets/index.js'), undefined);
  assert.equal(cacheControlFor('/login.js'), undefined);
  assert.equal(cacheControlFor('/other/index-AbC123_-.js'), undefined);
  assert.equal(cacheControlFor('/assets/sub/index-AbC123_-.js'), undefined);
});

/** Body text for a leak check; a compressed body that is not gzip is read as is. */
function gunzipSyncSafe(body: Buffer): string {
  try {
    return gunzipSync(body).toString();
  } catch {
    return body.toString();
  }
}
