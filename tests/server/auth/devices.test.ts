// The device store: token hashing, verify, revoke, name validation, cap and corrupt files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeFixture } from '../../helpers.ts';

const fx = makeFixture();
const { createDeviceStore, MAX_DEVICES } = await import('../../../src/server/auth/devices.ts');
const file = join(fx.dataDir, 'devices.json');

test('create returns the token once; only its hash is stored', () => {
  const deviceStore = createDeviceStore(fx.dataDir);
  const { id, token } = deviceStore.create('  Phone  ');
  assert.ok(token.length >= 40);
  assert.match(id, /^[0-9a-f]{12}$/);
  const raw = readFileSync(file, 'utf8');
  assert.ok(!raw.includes(token), 'the token never reaches the file');
  const stored = JSON.parse(raw).devices[0];
  assert.deepEqual(Object.keys(stored).sort(), ['createdMs', 'id', 'lastSeenMs', 'name', 'sha256']);
  assert.equal(stored.name, 'Phone');
  assert.match(stored.sha256, /^[0-9a-f]{64}$/);
  assert.equal(stored.lastSeenMs, null);
  // list() never exposes the hash
  assert.deepEqual(Object.keys(deviceStore.list()[0]).sort(), ['createdMs', 'id', 'lastSeenMs', 'name']);
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o077, 0, 'file is private');
});

test('verify matches the exact token only and survives a restart', () => {
  const deviceStore = createDeviceStore(fx.dataDir);
  const a = deviceStore.create('A');
  const b = deviceStore.create('B');
  assert.equal(deviceStore.verify(a.token)?.id, a.id);
  assert.equal(deviceStore.verify(b.token)?.id, b.id);
  for (const bad of ['', 'x', a.token + 'x', a.token.slice(1), 'a'.repeat(300)]) assert.equal(deviceStore.verify(bad), null);
  const again = createDeviceStore(fx.dataDir);
  assert.equal(again.verify(a.token)?.name, 'A');
});

test('revoke removes only that device', () => {
  const deviceStore = createDeviceStore(fx.dataDir);
  const a = deviceStore.create('keep');
  const b = deviceStore.create('drop');
  assert.deepEqual(deviceStore.revoke(b.id), { found: true, persisted: true });
  assert.equal(deviceStore.revoke(b.id).found, false);
  assert.equal(deviceStore.verify(b.token), null);
  assert.equal(deviceStore.verify(a.token)?.id, a.id);
  assert.equal(deviceStore.has(b.id), false);
  assert.equal(createDeviceStore(fx.dataDir).verify(b.token), null, 'persisted');
});

test('names are validated and the store is capped', () => {
  const deviceStore = createDeviceStore(join(fx.root, 'cap'));
  for (const bad of ['', '   ', 'x'.repeat(41), 'a\nb', 'a\u0000b', 'a\u202eb', 'a\u200bb', 'a\u2028b', 5 as unknown as string]) assert.throws(() => deviceStore.create(bad), /invalid device name/);
  for (let i = 0; i < MAX_DEVICES; i++) deviceStore.create(`d${i}`);
  assert.throws(() => deviceStore.create('one more'), /too many devices/);
});

test('a missing or corrupt file gives an empty store without crashing', () => {
  mkdirSync(fx.dataDir, { recursive: true });
  assert.deepEqual(createDeviceStore(join(fx.root, 'nowhere')).list(), []);
  const bad = '{"devices":[{"id":1},null,{"id":"a","name":"n","sha256":"zz","createdMs":1,"lastSeenMs":null}]}';
  for (const content of ['{not json', '[]', '{"devices":"x"}', bad]) {
    writeFileSync(file, content);
    const deviceStore = createDeviceStore(fx.dataDir);
    assert.deepEqual(deviceStore.list(), [], content);
    deviceStore.create('after'); // and it recovers
    assert.equal(createDeviceStore(fx.dataDir).list().length, 1);
  }
});

test('touch updates lastSeenMs in memory but writes at most once a minute per device', () => {
  let now = 1_000_000;
  const deviceStore = createDeviceStore(join(fx.root, 'touch'), () => now);
  const { id } = deviceStore.create('T');
  const filePath = join(fx.root, 'touch', 'devices.json');
  const seenOnDisk = () => JSON.parse(readFileSync(filePath, 'utf8')).devices[0].lastSeenMs;
  deviceStore.touch(id);
  assert.equal(seenOnDisk(), 1_000_000);
  now += 30_000;
  deviceStore.touch(id);
  assert.equal(deviceStore.list()[0].lastSeenMs, 1_030_000, 'memory is current');
  assert.equal(seenOnDisk(), 1_000_000, 'disk is not rewritten within a minute');
  now += 31_000;
  deviceStore.touch(id);
  assert.equal(seenOnDisk(), 1_061_000);
  deviceStore.touch('nope'); // unknown ids are ignored
});

test('a revoke whose write fails is reported as not persisted, but the device is gone in memory', () => {
  const dir = join(fx.root, 'unwritable');
  const deviceStore = createDeviceStore(dir);
  const a = deviceStore.create('A');
  const b = deviceStore.create('B');
  // Make the final rename fail: devices.json becomes a directory.
  rmSync(join(dir, 'devices.json'));
  mkdirSync(join(dir, 'devices.json'));
  assert.deepEqual(deviceStore.revoke(a.id), { found: true, persisted: false });
  assert.equal(deviceStore.verify(a.token), null, 'gone in memory');
  assert.equal(deviceStore.verify(b.token)?.id, b.id);
  assert.deepEqual(deviceStore.revoke('unknown'), { found: false, persisted: true }, 'an unknown id is not a persistence failure');
  // Once the file is writable again the next change persists the revoke too.
  rmSync(join(dir, 'devices.json'), { recursive: true });
  assert.deepEqual(deviceStore.revoke(b.id), { found: true, persisted: true });
  assert.equal(createDeviceStore(dir).list().length, 0);
});

test('a stored device id of pc is ignored: pc is reserved for the loopback exemption', () => {
  const dir = join(fx.root, 'reserved');
  mkdirSync(dir, { recursive: true });
  const hash = 'a'.repeat(64);
  writeFileSync(join(dir, 'devices.json'), JSON.stringify({ devices: [{ id: 'pc', name: 'sneaky', sha256: hash, createdMs: 1, lastSeenMs: null }, { id: 'ok', name: 'fine', sha256: hash, createdMs: 1, lastSeenMs: null }] }));
  assert.deepEqual(createDeviceStore(dir).list().map((device) => device.id), ['ok']);
});

test('one bad entry is dropped and the good ones are kept', () => {
  const dir = join(fx.root, 'one-bad');
  mkdirSync(dir, { recursive: true });
  const hash = 'b'.repeat(64);
  const good = { id: 'good', name: 'Tablet', sha256: hash, createdMs: 1, lastSeenMs: 5 };
  const devices = [
    { ...good, id: 7 },
    { ...good, id: 'bad-name', name: null },
    { ...good, id: 'bad-hash', sha256: 'xyz' },
    { ...good, id: 'bad-created', createdMs: '1' },
    { ...good, id: 'bad-seen', lastSeenMs: 'yesterday' },
    { id: 'missing-fields', name: 'x' },
    null,
    'text',
    good,
  ];
  writeFileSync(join(dir, 'devices.json'), JSON.stringify({ devices }));
  assert.deepEqual(createDeviceStore(dir).list().map((device) => device.id), ['good']);
});

test('a missing, corrupt or wrongly shaped file is an empty store', () => {
  const dir = join(fx.root, 'empty-store');
  mkdirSync(dir, { recursive: true });
  assert.equal(createDeviceStore(dir).list().length, 0, 'missing file');
  for (const content of ['{not json', 'null', '[]', '{"devices":{"id":"x"}}', '{}']) {
    writeFileSync(join(dir, 'devices.json'), content);
    assert.equal(createDeviceStore(dir).list().length, 0, content);
  }
});

test('a duplicate device id keeps only the first entry', () => {
  const dir = join(fx.root, 'duplicate-id');
  mkdirSync(dir, { recursive: true });
  const device = { id: 'same', name: 'First', sha256: 'c'.repeat(64), createdMs: 1, lastSeenMs: null };
  writeFileSync(join(dir, 'devices.json'), JSON.stringify({ devices: [device, { ...device, name: 'Second' }] }));
  assert.deepEqual(createDeviceStore(dir).list().map((listed) => listed.name), ['First']);
});
