import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DeviceInfo } from '../shared/types.ts';

export type { DeviceInfo };

interface StoredDevice extends DeviceInfo {
  /** Hex sha256 of the token. The token itself is never stored. */
  sha256: string;
}

export interface DeviceStore {
  /**
   * Returns the token once; only its hash is kept. Throws 'invalid device name', 'too many devices' or
   * 'could not save devices' (nothing is kept then: a token that would not survive a restart is never handed out).
   */
  create(name: string): { id: string; token: string };
  list(): DeviceInfo[];
  /**
   * Remove the device. `found` is false for an unknown id. `persisted` is false when the file could not be written:
   * the device is gone in memory (and stays gone until restart) but devices.json may still hold it, so the caller must
   * tell the user instead of reporting success.
   */
  revoke(id: string): { found: boolean; persisted: boolean };
  has(id: string): boolean;
  /** The device a token belongs to (timing-safe hash compare), or null. */
  verify(token: string): DeviceInfo | null;
  /** Record that the device made an authed request; the file is written at most once a minute per device. */
  touch(id: string): void;
}

export const MAX_DEVICES = 100;
export const NAME_MAX = 40;
const TOUCH_WRITE_MS = 60_000;
const TOKEN_MAX = 256;

const hashOf = (token: string) => createHash('sha256').update(token).digest();

function isStored(d: unknown): d is StoredDevice {
  const x = d as Partial<StoredDevice> | null;
  return (
    !!x &&
    typeof x.id === 'string' &&
    x.id !== 'pc' && // reserved for the loopback exemption
    typeof x.name === 'string' &&
    typeof x.sha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(x.sha256) &&
    typeof x.createdMs === 'number' &&
    (x.lastSeenMs === null || typeof x.lastSeenMs === 'number')
  );
}

const publicOf = (d: StoredDevice): DeviceInfo => ({ id: d.id, name: d.name, createdMs: d.createdMs, lastSeenMs: d.lastSeenMs });

/** Named, revocable device tokens in `<dataDir>/devices.json` (holds token hashes: never serve or commit it). */
export function createDeviceStore(dataDir: string, now: () => number = Date.now): DeviceStore {
  const file = join(dataDir, 'devices.json');
  let devices: StoredDevice[] = [];
  try {
    const j = JSON.parse(readFileSync(file, 'utf8')) as { devices?: unknown };
    if (Array.isArray(j.devices)) devices = j.devices.filter(isStored);
  } catch {
    // missing or corrupt: empty store
  }
  const lastWrite = new Map<string, number>();

  /** False when the file could not be written. */
  function save(): boolean {
    try {
      mkdirSync(dataDir, { recursive: true });
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ devices }), { mode: 0o600 });
      renameSync(tmp, file);
      return true;
    } catch {
      // keep the in-memory state; the next change retries
      try {
        rmSync(`${file}.tmp`, { force: true });
      } catch {
        // best effort
      }
      return false;
    }
  }

  return {
    create(name) {
      const clean = typeof name === 'string' ? name.trim() : '';
      if (!clean || clean.length > NAME_MAX || /[\p{C}\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(clean)) throw new Error('invalid device name');
      if (devices.length >= MAX_DEVICES) throw new Error('too many devices');
      const token = randomBytes(32).toString('base64url');
      const id = randomBytes(6).toString('hex');
      devices.push({ id, name: clean, sha256: hashOf(token).toString('hex'), createdMs: now(), lastSeenMs: null });
      if (!save()) {
        devices.pop();
        throw new Error('could not save devices');
      }
      return { id, token };
    },
    list: () => devices.map(publicOf),
    revoke(id) {
      const i = devices.findIndex((d) => d.id === id);
      if (i < 0) return { found: false, persisted: true };
      devices.splice(i, 1);
      lastWrite.delete(id);
      return { found: true, persisted: save() };
    },
    has: (id) => devices.some((d) => d.id === id),
    verify(token) {
      if (typeof token !== 'string' || token.length === 0 || token.length > TOKEN_MAX) return null;
      const h = hashOf(token);
      let found: StoredDevice | null = null;
      // Compare against every device so the time taken doesn't reveal which one matched.
      for (const d of devices) if (timingSafeEqual(h, Buffer.from(d.sha256, 'hex'))) found = d;
      return found ? publicOf(found) : null;
    },
    touch(id) {
      const d = devices.find((x) => x.id === id);
      if (!d) return;
      const t = now();
      d.lastSeenMs = t;
      const w = lastWrite.get(id);
      if (w === undefined || t - w >= TOUCH_WRITE_MS) {
        lastWrite.set(id, t);
        save();
      }
    },
  };
}
