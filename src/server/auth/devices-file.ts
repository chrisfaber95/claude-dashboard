import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isRecord } from '../../shared/guards.ts';
import type { DeviceInfo } from '../../shared/types/index.ts';

/** A device as stored in devices.json. */
export interface StoredDevice extends DeviceInfo {
  /** Hex sha256 of the token. The token itself is never stored. */
  sha256: string;
}

const FILE_MODE = 0o600;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

/** Check one parsed entry field by field; undefined when any field is missing or has the wrong type. */
function toStoredDevice(entry: unknown): StoredDevice | undefined {
  if (!isRecord(entry)) return undefined;
  if (!('id' in entry) || typeof entry.id !== 'string') return undefined;
  if (entry.id === 'pc') return undefined; // reserved for the loopback exemption
  if (!('name' in entry) || typeof entry.name !== 'string') return undefined;
  if (!('sha256' in entry) || typeof entry.sha256 !== 'string' || !SHA256_HEX_RE.test(entry.sha256)) return undefined;
  if (!('createdMs' in entry) || typeof entry.createdMs !== 'number') return undefined;
  if (!('lastSeenMs' in entry)) return undefined;
  const { lastSeenMs } = entry;
  if (lastSeenMs !== null && typeof lastSeenMs !== 'number') return undefined;
  return { id: entry.id, name: entry.name, sha256: entry.sha256, createdMs: entry.createdMs, lastSeenMs };
}

/** The devices file inside a data folder. */
export function devicesFilePath(dataDir: string): string {
  return join(dataDir, 'devices.json');
}

/** The valid devices of the file; an empty list when it is missing or corrupt. */
export function loadDevices(file: string): StoredDevice[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!isRecord(parsed) || !('devices' in parsed) || !Array.isArray(parsed.devices)) return [];
    const entries: unknown[] = parsed.devices;
    const seenIds = new Set<string>();
    return entries.flatMap((entry) => {
      const device = toStoredDevice(entry);
      // a duplicate id would survive revoke(), which removes only the first match
      if (!device || seenIds.has(device.id)) return [];
      seenIds.add(device.id);
      return [device];
    });
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
