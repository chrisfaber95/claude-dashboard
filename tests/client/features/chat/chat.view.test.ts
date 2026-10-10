// Chat view source guard: it may only call the message, summary and alert-dismiss endpoints.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../../../src/client/features/chat/chat.view.ts', import.meta.url), 'utf8');

/** First argument of an api() call: a whole string/template literal, else anything up to the next comma. */
const API_CALL = /\bapi\s*(?:<[^>(]*>)?\s*\(\s*(`[^`]*`|'[^']*'|"[^"]*"|[^,)]*)/g;

test('the chat never uses the command, start or stop endpoints', () => {
  for (const banned of ['/api/commands', '/stop', '/start']) {
    assert.ok(!source.includes(banned), `chat.ts must not contain ${banned}`);
  }
});

test('the only API paths in the chat are the session message, session summary and alert dismiss endpoints', () => {
  const allowed = new Set<string>([
    '`/api/sessions/${encodeURIComponent(pending.sessionId)}/message`',
    '`/api/sessions/${encodeURIComponent(sessionId)}/summary`',
    "'/api/alerts/dismiss'",
  ]);
  // Every request goes through api(). Its first argument must be exactly one of the allowed literals,
  // so a path built from pieces (without an /api/ literal) is caught too.
  const args = [...source.matchAll(API_CALL)].map((match) => match[1].trim());
  for (const argument of args) assert.ok(allowed.has(argument), `unexpected api() path in chat.ts: ${argument}`);
  assert.equal(args.length, allowed.size, 'each allowed endpoint is called exactly once');
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|EventSource|sendBeacon/.test(source), 'chat.ts must call the server only through api()');
  const literals: string[] = source.match(/\/api\/[^`'"]*/g) ?? [];
  for (const literal of literals) assert.ok(args.some((argument) => argument.includes(literal)), `stray API path in chat.ts: ${literal}`);
});

test('the endpoint check catches a path built without an /api/ literal', () => {
  const re = API_CALL;
  const sneaky = "await api<X>(['', 'ap' + 'i', 'commands'].join('/'), {})";
  assert.equal([...sneaky.matchAll(re)].length, 1);
  assert.ok([...sneaky.matchAll(re)][0][1].startsWith('['), 'a non-literal argument is captured and so rejected');
});

test('the chat never asks for a permission mode that skips the checks', () => {
  assert.ok(!/bypassPermissions|dontAsk/.test(source));
});
