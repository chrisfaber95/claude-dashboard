import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DeviceInfo } from '../../shared/types/index.ts';

/** A device as stored in devices.json. */
export interface StoredDevice extends DeviceInfo {
  /** Hex sha256 of the token. The token itself is never stored. */
  sha256: string;
}

const FILE_MODE = 0o600;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

function isStored(candidate: unknown): candidate is StoredDevice {
  const device = candidate as Partial<StoredDevice> | null;
  return (
    !!device &&
    typeof device.id === 'string' &&
    device.id !== 'pc' && // reserved for the loopback exemption
    typeof device.name === 'string' &&
    typeof device.sha256 === 'string' &&
    SHA256_HEX_RE.test(device.sha256) &&
    typeof device.createdMs === 'number' &&
    (device.lastSeenMs === null || typeof device.lastSeenMs === 'number')
  );
}

/** The devices file inside a data folder. */
export function devicesFilePath(dataDir: string): string {
  return join(dataDir, 'devices.json');
}

/** The valid devices of the file; an empty list when it is missing or corrupt. */
export function loadDevices(file: string): StoredDevice[] {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { devices?: unknown };
    if (Array.isArray(parsed.devices)) return parsed.devices.filter(isStored);
  } catch {
    // missing or corrupt: empty store
  }
  return [];
}

/** Write the devices through a temp file and a rename. False when the file could not be written. */
export function saveDevices(dataDir: string, file: string, devices: StoredDevice[]): boolean {
  const tempFile = `${file}.tmp`;
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(tempFile, JSON.stringify({ devices }), { mode: FILE_MODE });
    renameSync(tempFile, file);
    return true;
  } catch {
    // keep the in-memory state; the next change retries
    try {
      rmSync(tempFile, { force: true });
    } catch {
      // best effort
    }
    return false;
  }
}
