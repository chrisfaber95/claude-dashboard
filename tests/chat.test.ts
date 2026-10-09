import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/client/chat.ts', import.meta.url), 'utf8');

test('the chat never uses the command, start or stop endpoints', () => {
  for (const banned of ['/api/commands', '/stop', '/start']) {
    assert.ok(!source.includes(banned), `chat.ts must not contain ${banned}`);
  }
});

test('the only API paths in the chat are the session message and alert dismiss endpoints', () => {
  const paths: string[] = source.match(/\/api\/[^`'"]*/g) ?? [];
  const allowed = new Set<string>(['/api/sessions/${encodeURIComponent(p.sessionId)}/message', '/api/alerts/dismiss']);
  for (const p of paths) assert.ok(allowed.has(p), `unexpected API path in chat.ts: ${p}`);
  assert.ok(paths.includes('/api/alerts/dismiss'));
  assert.ok(paths.some((p) => p.startsWith('/api/sessions/') && p.endsWith('/message')));
});

test('the chat never asks for a permission mode that skips the checks', () => {
  assert.ok(!/bypassPermissions|dontAsk/.test(source));
});
