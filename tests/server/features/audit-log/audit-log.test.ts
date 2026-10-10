// Audit log reading: newest first, device filter, cap, malformed lines and allowlisted fields.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeFixture } from '../../../helpers.ts';

const fx = makeFixture();
const { AUDIT_MAX_BYTES, AUDIT_MAX_ENTRIES, parseAudit, readAudit, toAuditEntry } = await import('../../../../src/server/features/audit-log/audit-log.ts');
const log = join(fx.dataDir, 'commands.log');
const line = (fields: Record<string, unknown>) => JSON.stringify(fields);
const write = (lines: string[]) => {
  mkdirSync(fx.dataDir, { recursive: true });
  writeFileSync(log, lines.join('\n') + '\n');
};

test('a missing log is an empty list', async () => {
  rmSync(log, { force: true });
  assert.deepEqual(await readAudit(), []);
});

test('newest first, filtered by device id, capped at 200', async () => {
  const lines: string[] = [];
  for (let i = 0; i < 250; i++) lines.push(line({ ts: `t${i}`, action: 'start', deviceId: i % 2 ? 'aaaaaaaaaaaa' : 'pc', device: i % 2 ? 'phone' : 'This PC', ok: true }));
  write(lines);
  const all = await readAudit();
  assert.equal(all.length, AUDIT_MAX_ENTRIES);
  assert.equal(all[0].ts, 't249');
  assert.equal(all[199].ts, 't50');
  const phone = await readAudit('aaaaaaaaaaaa');
  assert.equal(phone.length, 125, 'the filter applies before the cap');
  assert.ok(phone.every((entry) => entry.deviceId === 'aaaaaaaaaaaa' && entry.device === 'phone'));
  assert.equal(phone[0].ts, 't249');
  assert.deepEqual(await readAudit('ffffffffffff'), []);
});

test('malformed lines are skipped, not fatal', () => {
  const text = [
    'not json',
    '{"ts":"t1","action":"start"',
    '[1,2,3]',
    '42',
    'null',
    '"string"',
    line({ ts: 't2' }),
    line({ action: 'stop' }),
    line({ ts: 5, action: 'stop' }),
    '',
    line({ ts: 't3', action: 'stop', ok: false }),
    '\u0000\u0001garbage',
  ].join('\n');
  assert.deepEqual(parseAudit(text), [{ ts: 't3', action: 'stop', ok: false }]);
});

test('only allowlisted fields leave the file, with sane types and lengths', () => {
  const entry = toAuditEntry({
    ts: '2026-10-09T10:00:00.000Z',
    action: 'message',
    ip: '192.168.1.20',
    device: 'phone',
    deviceId: 'aaaaaaaaaaaa',
    project: 'Alpha',
    session: 's-1',
    mode: 'plan',
    ok: true,
    prompt: 'x'.repeat(500),
    id: 'bg-123',
    name: 'secret name',
    token: 'sekret',
    code: 'pairing-code',
    extra: { nested: true },
  });
  assert.deepEqual(Object.keys(entry!).sort(), ['action', 'deviceId', 'device', 'mode', 'ok', 'project', 'prompt', 'session', 'ts'].sort());
  assert.equal(entry!.prompt!.length, 200);
  assert.ok(!JSON.stringify(entry).includes('192.168') && !JSON.stringify(entry).includes('sekret') && !JSON.stringify(entry).includes('pairing-code'));
  // wrong types are dropped, not coerced
  const odd = toAuditEntry({ ts: 't', action: 'a', ok: 'yes', project: 5, mode: { x: 1 }, prompt: null });
  assert.deepEqual(odd, { ts: 't', action: 'a' });
  assert.equal(toAuditEntry({ ts: 't', action: 'a', project: 'p'.repeat(1000) })!.project!.length, 120);
});

test('old entries still parse: no device fields, or the device id stored in `device`', () => {
  const old = toAuditEntry({ ts: 't', action: 'start', project: 'Alpha', ok: true, ip: '127.0.0.1' });
  assert.deepEqual(old, { ts: 't', action: 'start', project: 'Alpha', ok: true });
  assert.deepEqual(toAuditEntry({ ts: 't', action: 'device-create', device: 'pc' }), { ts: 't', action: 'device-create', deviceId: 'pc' });
  assert.deepEqual(toAuditEntry({ ts: 't', action: 'device-create', device: '0123456789ab' }), { ts: 't', action: 'device-create', deviceId: '0123456789ab' });
  assert.deepEqual(toAuditEntry({ ts: 't', action: 'device-create', device: null }), { ts: 't', action: 'device-create' });
  // a real name is kept as a name, an id-looking name next to a deviceId is left alone
  assert.deepEqual(toAuditEntry({ ts: 't', action: 'a', device: 'Kitchen', deviceId: 'pc' }), { ts: 't', action: 'a', device: 'Kitchen', deviceId: 'pc' });
  assert.deepEqual(parseAudit(line({ ts: 't', action: 'start', device: 'pc' }), 'pc'), [{ ts: 't', action: 'start', deviceId: 'pc' }], 'the filter also finds old entries');
});

test('at most the last megabyte is read, and a cut first line is dropped', async () => {
  const filler = line({ ts: 'old', action: 'start', prompt: 'p'.repeat(150) });
  const count = Math.ceil((AUDIT_MAX_BYTES * 1.5) / (filler.length + 1));
  const lines = Array.from({ length: count }, (_, i) => line({ ts: `n${i}`, action: 'start', prompt: 'p'.repeat(150) }));
  write(lines);
  const all = await readAudit();
  assert.equal(all.length, AUDIT_MAX_ENTRIES);
  assert.equal(all[0].ts, `n${count - 1}`);
  // an entry from the first (unread) third of the file never shows up, even when filtering for it
  const early = lines.slice(0, 1000).map((currentLine) => JSON.parse(currentLine).ts as string);
  assert.ok(!all.some((entry) => early.includes(entry.ts)));
  // a device that only appears in the unread part yields nothing
  writeFileSync(log, line({ ts: 'ancient', action: 'start', deviceId: 'bbbbbbbbbbbb' }) + '\n' + lines.join('\n') + '\n');
  assert.deepEqual(await readAudit('bbbbbbbbbbbb'), []);
});

test('an unreadable log is an error for the caller to turn into a fixed message', async () => {
  rmSync(log, { force: true });
  mkdirSync(log); // a directory where the file should be
  try {
    await assert.rejects(readAudit());
  } finally {
    rmSync(log, { recursive: true, force: true });
  }
});

test('approval entries keep tool, text cut to 500 characters and outcome, and drop unknown fields', () => {
  const entry = toAuditEntry({ ts: 't1', action: 'approval', tool: 'Bash', text: 'x'.repeat(600), outcome: 'allow', secret: 'nope' });
  assert.deepEqual(entry, { ts: 't1', action: 'approval', tool: 'Bash', text: 'x'.repeat(500), outcome: 'allow' });
});
