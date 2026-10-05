import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { makeFixture } from './helpers.ts';

const fx = makeFixture();
const publicDir = join(fx.root, 'public');
mkdirSync(publicDir);
writeFileSync(join(publicDir, 'index.html'), '<!doctype html><title>t</title>');
writeFileSync(join(publicDir, 'app.js'), 'console.log(1)');
writeFileSync(join(fx.root, 'secret.txt'), 'nope');

const { createDashboardServer } = await import('../src/server/server.ts');
const server = createDashboardServer({ publicDir });
let base = '';

before(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.closeAllConnections();
  server.close();
});

/** Raw GET so path traversal isn't normalised away by a URL parser. */
function rawGet(path: string): Promise<{ status: number; type: string; body: string }> {
  const { port } = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type']), body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('serves dashboard state as JSON', async () => {
  const res = await fetch(`${base}/api/state`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type')!, /application\/json/);
  const j = await res.json();
  for (const k of ['projects', 'sessions', 'messages', 'usage', 'limits']) assert.ok(k in j, k);
});

test('streams state over server-sent events', async () => {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/events`, { signal: ctrl.signal });
  assert.match(res.headers.get('content-type')!, /text\/event-stream/);
  const reader = res.body!.getReader();
  const { value } = await reader.read();
  const text = new TextDecoder().decode(value);
  assert.match(text, /^data: \{/);
  ctrl.abort();
});

test('serves static files with the right content type', async () => {
  const idx = await rawGet('/');
  assert.equal(idx.status, 200);
  assert.match(idx.type, /text\/html/);
  const js = await rawGet('/app.js');
  assert.match(js.type, /javascript/);
  assert.equal((await rawGet('/missing.css')).status, 404);
});

test('blocks path traversal out of the public dir', async () => {
  for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%5csecret.txt']) {
    const r = await rawGet(p);
    assert.notEqual(r.body, 'nope', p);
    assert.ok([403, 404].includes(r.status), `${p} -> ${r.status}`);
  }
});
