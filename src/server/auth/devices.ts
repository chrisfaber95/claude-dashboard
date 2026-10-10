import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { DeviceInfo } from '../../shared/types/index.ts';
import { devicesFilePath, loadDevices, saveDevices, type StoredDevice } from './devices-file.ts';

export type { DeviceInfo };

/** The named, revocable device tokens that may sign in. */
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
const TOKEN_BYTES = 32;
const DEVICE_ID_BYTES = 6;
/** Control, line-separator and bidi-override characters would let a name spoof or break the device list. */
const UNSAFE_NAME_RE = /[\p{C}\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;

const hashOf = (token: string) => createHash('sha256').update(token).digest();

const publicOf = (device: StoredDevice): DeviceInfo => ({
  id: device.id,
  name: device.name,
  createdMs: device.createdMs,
  lastSeenMs: device.lastSeenMs,
});

/** The trimmed name, or throws 'invalid device name'. */
function cleanName(name: unknown): string {
  const clean = typeof name === 'string' ? name.trim() : '';
  if (!clean || clean.length > NAME_MAX || UNSAFE_NAME_RE.test(clean)) throw new Error('invalid device name');
  return clean;
}

/** The device whose hash equals the token's. Compares against every device so the time doesn't reveal which matched. */
function findByToken(devices: StoredDevice[], token: string): StoredDevice | null {
  const tokenHash = hashOf(token);
  let found: StoredDevice | null = null;
  for (const device of devices) if (timingSafeEqual(tokenHash, Buffer.from(device.sha256, 'hex'))) found = device;
  return found;
}

/** Named, revocable device tokens in `<dataDir>/devices.json` (holds token hashes: never serve or commit it). */
export function createDeviceStore(dataDir: string, now: () => number = Date.now): DeviceStore {
  const file = devicesFilePath(dataDir);
  const devices = loadDevices(file);
  const lastWriteMs = new Map<string, number>();
  const save = () => saveDevices(dataDir, file, devices);

  return {
    create(name) {
      const clean = cleanName(name);
      if (devices.length >= MAX_DEVICES) throw new Error('too many devices');
      const token = randomBytes(TOKEN_BYTES).toString('base64url');
      const id = randomBytes(DEVICE_ID_BYTES).toString('hex');
      devices.push({ id, name: clean, sha256: hashOf(token).toString('hex'), createdMs: now(), lastSeenMs: null });
      if (!save()) {
        devices.pop();
        throw new Error('could not save devices');
      }
      return { id, token };
    },
    list: () => devices.map(publicOf),
    revoke(id) {
      const index = devices.findIndex((device) => device.id === id);
      if (index < 0) return { found: false, persisted: true };
      devices.splice(index, 1);
      lastWriteMs.delete(id);
      return { found: true, persisted: save() };
    },
    has: (id) => devices.some((device) => device.id === id),
    verify(token) {
      if (typeof token !== 'string' || token.length === 0 || token.length > TOKEN_MAX) return null;
      const found = findByToken(devices, token);
      return found ? publicOf(found) : null;
    },
    touch(id) {
      const device = devices.find((candidate) => candidate.id === id);
      if (!device) return;
      const timeMs = now();
      device.lastSeenMs = timeMs;
      const previousWriteMs = lastWriteMs.get(id);
      if (previousWriteMs === undefined || timeMs - previousWriteMs >= TOUCH_WRITE_MS) {
        lastWriteMs.set(id, timeMs);
        save();
      }
    },
  };
}
