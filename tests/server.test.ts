import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { makeFixture, raw } from './helpers.ts';

const fx = makeFixture();
// Never read the real team-hq board: a ticket in review would add alerts.
process.env.TEAM_HQ_DIR = join(fx.root, 'no-team-hq');
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

function apiPost(path: string, body: unknown, headers: Record<string, string> = {}) {
  const { port } = server.address() as AddressInfo;
  const host = `127.0.0.1:${port}`;
  return raw(port, { method: 'POST', path, body: typeof body === 'string' ? body : JSON.stringify(body), headers: { Host: host, Origin: `http://${host}`, 'X-Dashboard': '1', ...headers } });
}
const alertIds = async () => ((await (await fetch(`${base}/api/state`)).json()) as { alerts: { items: { id: string }[]; threshold: number } }).alerts;

test('POST /api/alerts/dismiss hides an open alert and rejects anything else', async () => {
  writeFileSync(join(fx.claudeDir, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 'wait-1', name: 'waiter', cwd: fx.root, status: 'waiting' }));
  assert.deepEqual((await alertIds()).items.map((a) => a.id), ['session:wait-1']);

  const noHeader = await apiPost('/api/alerts/dismiss', { id: 'session:wait-1' }, { 'X-Dashboard': '' });
  assert.equal(noHeader.status, 403);
  const badOrigin = await apiPost('/api/alerts/dismiss', { id: 'session:wait-1' }, { Origin: 'http://evil.example' });
  assert.equal(badOrigin.status, 403);
  assert.equal((await alertIds()).items.length, 1, 'rejected calls change nothing');

  for (const body of [{}, { id: 5 }, { id: '' }, { id: 'x'.repeat(201) }, '[1]', 'nope']) {
    const r = await apiPost('/api/alerts/dismiss', body);
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  const unknown = await apiPost('/api/alerts/dismiss', { id: 'session:not-open' });
  assert.equal(unknown.status, 404);
  assert.deepEqual(JSON.parse(unknown.body), { error: 'unknown alert' }, 'fixed string, id not echoed');

  const ok = await apiPost('/api/alerts/dismiss', { id: 'session:wait-1' });
  assert.equal(ok.status, 200);
  assert.deepEqual(JSON.parse(ok.body), { ok: true });
  assert.deepEqual((await alertIds()).items, []);

  const big = await apiPost('/api/alerts/dismiss', JSON.stringify({ id: 'a'.repeat(70_000) }));
  assert.equal(big.status, 413);
});

test('POST /api/settings/alerts sets the threshold used by the next state build', async () => {
  const noHeader = await apiPost('/api/settings/alerts', { threshold: 50 }, { 'X-Dashboard': '' });
  assert.equal(noHeader.status, 403);
  assert.equal((await alertIds()).threshold, 80);

  for (const body of [{}, { threshold: '50' }, { threshold: 0 }, { threshold: 101 }, { threshold: 55.5 }, { threshold: null }]) {
    const r = await apiPost('/api/settings/alerts', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.deepEqual(JSON.parse(r.body), { error: 'threshold must be a whole number from 1 to 100' });
  }
  assert.equal((await apiPost('/api/settings/alerts', '[]')).status, 400);
  assert.equal((await alertIds()).threshold, 80);

  const ok = await apiPost('/api/settings/alerts', { threshold: 42 });
  assert.equal(ok.status, 200);
  assert.deepEqual(JSON.parse(ok.body), { ok: true });
  assert.equal((await alertIds()).threshold, 42);
});

test('without a login there are no devices: the endpoints 404 and manageDevices is false', async () => {
  assert.equal((await alertIds().then(() => fetch(`${base}/api/devices`))).status, 404);
  const created = await apiPost('/api/devices', { name: 'x' });
  assert.equal(created.status, 404);
  assert.deepEqual(JSON.parse(created.body), { error: 'devices are not available' });
  assert.equal((await apiPost('/api/devices/revoke', { id: 'x' })).status, 404);
  const j = (await (await fetch(`${base}/api/state`)).json()) as { features: { manageDevices: boolean } };
  assert.equal(j.features.manageDevices, false);
});

test('without a login /pair does not exist', async () => {
  const r = await fetch(`${base}/pair?c=anything`, { redirect: 'manual' });
  assert.equal(r.status, 404);
  assert.equal(r.headers.get('set-cookie'), null);
});
