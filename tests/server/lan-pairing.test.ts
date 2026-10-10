// QR pairing links: one-time codes, the confirm page and their request checks.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { raw } from '../helpers.ts';
import { fx, devices, token, port, host, get, post, pcCall, deviceCall, signInDevice, newDevice, formHdr, confirm, pairOf } from './lan-test-setup.ts';

test('the PC issues a pairing link that contains a one-time code and never the device token', async () => {
  const dev = await newDevice('qr phone');
  const response = await pcCall('POST', '/api/devices/pair', { id: dev.id });
  assert.equal(response.status, 200);
  const info = JSON.parse(response.body) as { path: string; urls: string[]; expiresMs: number };
  assert.deepEqual(Object.keys(info).sort(), ['expiresMs', 'path', 'urls']);
  assert.match(info.path, /^\/pair\?c=[A-Za-z0-9_-]{40,}$/);
  assert.ok(info.expiresMs > Date.now() + 9 * 60_000 && info.expiresMs <= Date.now() + 10 * 60_000 + 1000, 'valid for 10 minutes');
  for (const url of info.urls) assert.ok(url.startsWith('https://') && url.endsWith(`:${port}${info.path}`), url);
  assert.ok(!response.body.includes(dev.token), 'the device token is not in the link');
  assert.ok(!(await pcCall('GET', '/api/devices')).body.includes(info.path.slice(8)), 'the code is not listed anywhere');
  assert.ok(!readFileSync(join(fx.dataDir, 'devices.json'), 'utf8').includes(info.path.slice(8)), 'nor stored on disk');
});

test('opening the link only shows a confirm page; the button signs the browser in once', async () => {
  const dev = await newDevice('qr phone 2');
  const { path } = await pairOf(dev.id);
  // a camera app or link preview fetching the URL (twice) changes nothing
  for (let i = 0; i < 2; i++) {
    const page = await get(path); // a phone: non-loopback Host, no cookie
    assert.equal(page.status, 200);
    assert.equal(page.headers['cache-control'], 'no-store');
    assert.equal(page.headers['set-cookie'], undefined);
    assert.match(page.body, /data-state="ok"/);
    assert.match(page.body, /Sign in as <b>qr phone 2<\/b>\?/);
  }
  const ok = await confirm(path);
  assert.equal(ok.status, 200);
  const set = String(ok.headers['set-cookie']);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict']) assert.match(set, new RegExp(flag));
  const cValue = set.split(';')[0];
  assert.equal((await get('/api/state', { Cookie: cValue })).status, 200);
  assert.equal((await deviceCall(cValue, 'GET', '/api/devices')).status, 403, 'a paired phone is a normal device, not the PC');

  const again = await confirm(path);
  assert.equal(again.status, 401);
  assert.equal(again.headers['set-cookie'], undefined);
  assert.match((await get(path)).body, /data-state="bad"/, 'the page now says the code is gone');
  // the session from the first sign-in is unaffected
  assert.equal((await get('/api/state', { Cookie: cValue })).status, 200);
});

test('the confirm page escapes the device name', async () => {
  const dev = await newDevice('<img src=x onerror=1>');
  const page = await get((await pairOf(dev.id)).path);
  assert.ok(!page.body.includes('<img'), page.body);
  assert.match(page.body, /&#60;img/);
});

test('unknown, malformed and missing codes show the error page, and failed POSTs raise a failed-sign-in alert', async () => {
  const signinCount = async () =>
    (JSON.parse((await pcCall('GET', '/api/state')).body).alerts.items as Array<{ id: string; kind: string }>).filter((a) => a.kind === 'signin').length;
  for (const a of await (async () => (JSON.parse((await pcCall('GET', '/api/state')).body).alerts.items as Array<{ id: string; kind: string }>).filter((item) => item.kind === 'signin'))()) {
    await pcCall('POST', '/api/alerts/dismiss', { id: a.id });
  }
  assert.equal(await signinCount(), 0);
  for (const filePath of ['/pair?c=' + 'A'.repeat(43), '/pair?c=', '/pair']) {
    const page = await get(filePath);
    assert.equal(page.status, 200, filePath);
    assert.match(page.body, /data-state="bad"/, filePath);
    assert.equal(page.headers['set-cookie'], undefined, filePath);
  }
  assert.equal(await signinCount(), 0, 'looking at the page is not a sign-in attempt');
  for (const body of ['c=' + 'A'.repeat(43), 'c=', '']) {
    const response = await post('/pair', body, formHdr);
    assert.equal(response.status, 401, body);
    assert.equal(response.headers['set-cookie'], undefined, body);
    assert.deepEqual(JSON.parse(response.body), { error: 'invalid or used code' });
  }
  assert.equal(await signinCount(), 1, 'one alert for the one source address');
  const detail = (JSON.parse((await pcCall('GET', '/api/state')).body).alerts.items as Array<{ kind: string; detail: string }>).find((a) => a.kind === 'signin')!.detail;
  assert.match(detail, /3 failed attempts/);
  assert.ok(!detail.includes('AAAA'), 'the tried code is not kept');
  // a good sign-in afterwards clears the rate-limit budget
  const dev = await newDevice('after failures');
  assert.equal((await confirm((await pairOf(dev.id)).path)).status, 200);
});

test('POST /pair is held to the same-origin check', async () => {
  const dev = await newDevice('post probe');
  const { path } = await pairOf(dev.id);
  const code = new URL(path, 'https://x').searchParams.get('c');
  const response = await raw(port, { https: true, method: 'POST', path: '/pair', body: 'c=' + code, headers: { Host: host, Origin: 'https://evil.example', ...formHdr } });
  assert.equal(response.status, 403);
  assert.equal(response.headers['set-cookie'], undefined);
  const noOrigin = await raw(port, { https: true, method: 'POST', path: '/pair', body: 'c=' + code, headers: { Host: host, ...formHdr } });
  assert.equal(noOrigin.status, 403);
  assert.equal((await confirm(path)).status, 200, 'the code was not spent by the refused POSTs');
});

test('revoking a device invalidates its unused pairing code', async () => {
  const dev = await newDevice('revoked before scan');
  const { path } = await pairOf(dev.id);
  assert.equal((await pcCall('POST', '/api/devices/revoke', { id: dev.id })).status, 200);
  assert.match((await get(path)).body, /data-state="bad"/);
  const response = await confirm(path);
  assert.equal(response.status, 401);
  assert.equal(response.headers['set-cookie'], undefined);
});

test('only the PC can issue pairing links, with all request checks and fixed errors', async () => {
  const dev = await newDevice('guard');
  const call = await signInDevice((await newDevice('other')).token);
  const asDevice = await deviceCall(call, 'POST', '/api/devices/pair', { id: dev.id });
  assert.equal(asDevice.status, 403);
  assert.deepEqual(JSON.parse(asDevice.body), { error: 'only this PC can manage devices' });
  const anon = await raw(port, { https: true, method: 'POST', path: '/api/devices/pair', body: '{}', headers: { Host: host, Origin: `https://${host}`, 'X-Dashboard': '1' } });
  assert.equal(anon.status, 401);
  assert.equal((await pcCall('POST', '/api/devices/pair', { id: dev.id }, { 'X-Dashboard': '' })).status, 403);
  assert.equal((await pcCall('POST', '/api/devices/pair', { id: dev.id }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await pcCall('GET', '/api/devices/pair')).status, 405);
  for (const body of [{}, { id: 5 }, { id: 'ffffffffffff' }]) {
    const response = await pcCall('POST', '/api/devices/pair', body);
    assert.equal(response.status, 404, JSON.stringify(body));
    assert.deepEqual(JSON.parse(response.body), { error: 'unknown device' });
  }
  assert.equal((await pcCall('POST', '/api/devices/pair', JSON.stringify({ id: 'x'.repeat(70_000) }))).status, 413, 'body cap applies');
});

test('pairing links are audited without the code', async () => {
  const dev = await newDevice('audited pairing');
  const { path } = await pairOf(dev.id);
  const text = readFileSync(join(fx.dataDir, 'commands.log'), 'utf8');
  assert.ok(!text.includes(path.slice(8)), 'the code is never logged');
  const entry = text.trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>).filter((currentEntry) => currentEntry.action === 'device-pair' && currentEntry.id === dev.id);
  assert.equal(entry.length, 1);
  assert.deepEqual([entry[0].device, entry[0].deviceId, entry[0].ok], ['This PC', 'pc', true]);
});

// ---- audit log by device (T-012) ----
