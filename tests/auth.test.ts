import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { createAuth, loadOrCreateToken, readCookie } from '../src/server/auth.ts';
import { makeFixture } from './helpers.ts';

const fx = makeFixture();
const TOKEN = 'a'.repeat(43);
const reqWith = (cookie?: string) => ({ headers: cookie ? { cookie } : {} }) as IncomingMessage;
const sidFrom = (setCookie: string) => setCookie.split(';')[0].split('=')[1];

test('loadOrCreateToken creates a long random token once and then reuses it', () => {
  const a = loadOrCreateToken(fx.dataDir);
  assert.equal(a.created, true);
  assert.ok(a.token.length >= 40);
  const b = loadOrCreateToken(fx.dataDir);
  assert.deepEqual(b, { token: a.token, created: false });
  assert.equal(readFileSync(join(fx.dataDir, 'token'), 'utf8').trim(), a.token);
});

test('loadOrCreateToken replaces a token that is too short', () => {
  writeFileSync(join(fx.dataDir, 'token'), 'short\n');
  assert.equal(loadOrCreateToken(fx.dataDir).created, true);
});

test('login accepts only the exact token and issues an authenticating cookie', () => {
  const auth = createAuth(TOKEN);
  assert.equal(auth.login('1.1.1.1', 'wrong'), null);
  assert.equal(auth.login('1.1.1.1', TOKEN + 'x'), null);
  const sid = auth.login('1.1.1.1', ` ${TOKEN}\n`);
  assert.equal(typeof sid, 'string');
  const cookie = auth.cookie(sid as string, true);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
  assert.ok(auth.isAuthed(reqWith(`other=1; ${cookie.split(';')[0]}`)));
  assert.ok(!auth.isAuthed(reqWith('dash_sid=forged')));
  assert.ok(!auth.isAuthed(reqWith()));
});

test('login is rate limited per IP for a minute', () => {
  let now = 0;
  const auth = createAuth(TOKEN, () => now);
  for (let i = 0; i < 5; i++) assert.equal(auth.login('2.2.2.2', 'nope'), null);
  assert.equal(auth.login('2.2.2.2', TOKEN), 'rate-limited', 'even the right token is refused while limited');
  assert.equal(typeof auth.login('3.3.3.3', TOKEN), 'string', 'other IPs are unaffected');
  now = 61_000;
  assert.equal(typeof auth.login('2.2.2.2', TOKEN), 'string');
});

test('sessions expire after 7 days and logout revokes them', () => {
  let now = 0;
  const auth = createAuth(TOKEN, () => now);
  const sid = auth.login('4.4.4.4', TOKEN) as string;
  const req = reqWith(`dash_sid=${sid}`);
  assert.ok(auth.isAuthed(req));
  now = 7 * 86_400_000 + 1;
  assert.ok(!auth.isAuthed(req));

  const sid2 = auth.login('4.4.4.4', TOKEN) as string;
  const req2 = reqWith(`dash_sid=${sid2}`);
  auth.logout(req2);
  assert.ok(!auth.isAuthed(req2));
  assert.match(auth.clearCookie(false), /Max-Age=0/);
  assert.equal(sidFrom(auth.cookie('abc', false)), 'abc');
});

test('readCookie parses multiple cookies', () => {
  assert.equal(readCookie(reqWith('a=1; dash_sid=xyz; b=2'), 'dash_sid'), 'xyz');
  assert.equal(readCookie(reqWith('a=1'), 'dash_sid'), null);
});
