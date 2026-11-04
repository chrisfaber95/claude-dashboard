// Search routes: behind the login, POST-only with the request checks, proxied to the injected service, fixed errors.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeFixture, raw } from '../helpers.ts';

const fx = makeFixture();
process.env.TEAM_HQ_DIR = join(fx.root, 'no-team-hq');
const publicDir = join(fx.root, 'public');
mkdirSync(publicDir);
writeFileSync(join(publicDir, 'index.html'), '<!doctype html><title>t</title>');

const { createDashboardServer } = await import('../../src/server/server.ts');
const { createAuth } = await import('../../src/server/auth/auth.ts');
const { createDeviceStore } = await import('../../src/server/auth/devices.ts');
const { ensureCert } = await import('../../src/server/auth/tls.ts');
const { createSearchClient } = await import('../../src/server/features/search/search.ts');

const UPSTREAM = 'http://search.tailnet.invalid:8120';
const upstreamCalls: string[] = [];
let isUpstreamDown = false;
const search = createSearchClient({
  baseUrl: UPSTREAM,
  token: 'upstream-secret',
  fetch: async (input) => {
    upstreamCalls.push(String(input));
    if (isUpstreamDown) throw new TypeError('connect ECONNREFUSED');
    const path = new URL(String(input)).pathname;
    if (path === '/query') return Response.json({ results: [{ source: 'wiki/a.md', location: 'Intro', date: '2026-11-01', project: 'homelab', source_type: 'wiki' }] });
    if (path === '/ask') return Response.json({ answer: '<img src=x onerror=alert(1)>', citations: [], request_id: 'req-1', backend: 'local' });
    return Response.json({ ok: true });
  },
});

const local = createDashboardServer({ publicDir, search });
const unconfigured = createDashboardServer({ publicDir, search: null });
const devices = createDeviceStore(fx.dataDir);
const { token } = devices.create('test phone');
const lan = createDashboardServer({ publicDir, auth: createAuth(devices), tls: ensureCert(fx.dataDir), search });
const ports = { local: 0, unconfigured: 0, lan: 0 };

async function listen(server: typeof local): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('server is not listening');
  return address.port;
}
before(async () => {
  ports.local = await listen(local);
  ports.unconfigured = await listen(unconfigured);
  ports.lan = await listen(lan);
});
after(() => {
  for (const server of [local, unconfigured, lan]) {
    server.closeAllConnections();
    server.close();
  }
});

const HEADERS = { 'Content-Type': 'application/json', 'X-Dashboard': '1' };
const postLocal = (path: string, body: unknown, headers: Record<string, string> = HEADERS) =>
  raw(ports.local, { method: 'POST', path, body: JSON.stringify(body), headers: { Host: `127.0.0.1:${ports.local}`, Origin: `http://127.0.0.1:${ports.local}`, ...headers } });

test('query returns normalised results and calls only the upstream /query', async () => {
  upstreamCalls.length = 0;
  const response = await postLocal('/api/search/query', { question: 'where?' });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body).results[0].sourceType, 'wiki');
  assert.deepEqual(upstreamCalls, [`${UPSTREAM}/query`]);
});

test('ask returns the answer as plain data (escaping is the client job) and the request id', async () => {
  const response = await postLocal('/api/search/ask', { question: 'why?', hard: true });
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.answer, '<img src=x onerror=alert(1)>');
  assert.equal(body.requestId, 'req-1');
  assert.ok(!response.body.includes('tailnet.invalid') && !response.body.includes('upstream-secret'));
});

test('feedback is forwarded; a bad id is a 400', async () => {
  assert.equal((await postLocal('/api/search/feedback', { requestId: 'req-1' })).status, 200);
  assert.equal((await postLocal('/api/search/feedback', { requestId: '../x' })).status, 400);
});

test('an unreachable service is a 502 with a fixed message and no address', async () => {
  isUpstreamDown = true;
  const response = await postLocal('/api/search/ask', { question: 'why?' });
  isUpstreamDown = false;
  assert.equal(response.status, 502);
  assert.deepEqual(JSON.parse(response.body), { error: 'The search service is unreachable.' });
});

test('the request checks apply: no X-Dashboard header or a foreign Origin is refused', async () => {
  upstreamCalls.length = 0;
  assert.equal((await postLocal('/api/search/query', { question: 'q' }, { 'Content-Type': 'application/json' })).status, 403);
  assert.equal((await postLocal('/api/search/query', { question: 'q' }, { ...HEADERS, Origin: 'http://evil.example' })).status, 403);
  assert.equal(upstreamCalls.length, 0);
});

test('only POST reaches the proxy; other paths under /api/search/ do not exist', async () => {
  const get = await raw(ports.local, { path: '/api/search/query', headers: { Host: `127.0.0.1:${ports.local}` } });
  assert.notEqual(get.status, 200);
  assert.equal((await postLocal('/api/search/admin', { question: 'q' })).status, 404);
  assert.equal(upstreamCalls.length, 0);
});

test('without a configured service the routes answer 503 and the state flag is off', async () => {
  const response = await raw(ports.unconfigured, {
    method: 'POST',
    path: '/api/search/query',
    body: JSON.stringify({ question: 'q' }),
    headers: { ...HEADERS, Host: `127.0.0.1:${ports.unconfigured}`, Origin: `http://127.0.0.1:${ports.unconfigured}` },
  });
  assert.equal(response.status, 503);
  const state = JSON.parse((await raw(ports.unconfigured, { path: '/api/state', headers: { Host: `127.0.0.1:${ports.unconfigured}` } })).body);
  assert.equal(state.features.search, false);
  const withSearch = JSON.parse((await raw(ports.local, { path: '/api/state', headers: { Host: `127.0.0.1:${ports.local}` } })).body);
  assert.equal(withSearch.features.search, true);
});

test('in LAN mode the search routes need a login', async () => {
  const host = `192.168.1.50:${ports.lan}`;
  upstreamCalls.length = 0;
  const anonymous = await raw(ports.lan, { https: true, method: 'POST', path: '/api/search/ask', body: JSON.stringify({ question: 'q' }), headers: { ...HEADERS, Host: host, Origin: `https://${host}` } });
  assert.equal(anonymous.status, 401);
  assert.equal(upstreamCalls.length, 0);

  const login = await raw(ports.lan, { https: true, method: 'POST', path: '/login', body: `token=${encodeURIComponent(token)}`, headers: { Host: host, Origin: `https://${host}`, 'Content-Type': 'application/x-www-form-urlencoded' } });
  const cookie = String(login.headers['set-cookie']).split(';')[0];
  const signedIn = await raw(ports.lan, { https: true, method: 'POST', path: '/api/search/query', body: JSON.stringify({ question: 'q' }), headers: { ...HEADERS, Host: host, Origin: `https://${host}`, Cookie: cookie } });
  assert.equal(signedIn.status, 200);
});
