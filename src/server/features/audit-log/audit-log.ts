import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR } from '../../config.ts';
import type { AuditEntry } from '../../../shared/types/index.ts';

// The only fields that ever leave `commands.log` through the API (never `ip`, ids of targets, names, codes).
export type { AuditEntry };

export const AUDIT_MAX_ENTRIES = 200;
/** `GET /api/launches` returns this many launches at most. */
export const LAUNCHES_MAX = 50;
/** At most this much of the end of the file is read. */
export const AUDIT_MAX_BYTES = 1024 * 1024;
const FIELD_MAX = 200;

const ID_LIKE = /^(?:pc|[0-9a-f]{12})$/;

function str(v: unknown, max = FIELD_MAX): string | undefined {
  return typeof v === 'string' ? v.slice(0, max) : undefined;
}

/** One parsed log line reduced to the allowlisted fields, or null when it is not an entry. */
export function toAuditEntry(raw: unknown): AuditEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const ts = str(r.ts, 40);
  const action = str(r.action, 40);
  if (!ts || !action) return null;
  let device = str(r.device, 80);
  let deviceId = str(r.deviceId, 64);
  // Entries written before device names existed carried the device id in `device`.
  if (deviceId === undefined && device !== undefined && ID_LIKE.test(device)) {
    deviceId = device;
    device = undefined;
  }
  const entry: AuditEntry = { ts, action };
  if (device !== undefined) entry.device = device;
  if (deviceId !== undefined) entry.deviceId = deviceId;
  for (const k of ['project', 'session', 'mode'] as const) {
    const v = str(r[k], 120);
    if (v !== undefined) entry[k] = v;
  }
  if (typeof r.ok === 'boolean') entry.ok = r.ok;
  const prompt = str(r.prompt);
  if (prompt !== undefined) entry.prompt = prompt;
  const goal = str(r.goal, 500);
  if (goal !== undefined) entry.goal = goal;
  if (typeof r.notesLength === 'number' && Number.isSafeInteger(r.notesLength) && r.notesLength >= 0) entry.notesLength = r.notesLength;
  return entry;
}

export interface AuditFilter {
  /** Only entries with this action. */
  action?: string;
  limit?: number;
}

/** Parse log text: newest first, malformed lines skipped, optionally only one device or action, at most `limit` entries. */
export function parseAudit(text: string, deviceId?: string, { action, limit = AUDIT_MAX_ENTRIES }: AuditFilter = {}): AuditEntry[] {
  const out: AuditEntry[] = [];
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const e = toAuditEntry(parsed);
    if (!e) continue;
    if (deviceId !== undefined && e.deviceId !== deviceId) continue;
    if (action !== undefined && e.action !== action) continue;
    out.push(e);
  }
  return out;
}

/** The newest audit entries from `<DATA_DIR>/commands.log`, reading at most its last megabyte. A missing file is empty. */
export async function readAudit(deviceId?: string, filter?: AuditFilter): Promise<AuditEntry[]> {
  let fh;
  try {
    fh = await open(join(DATA_DIR, 'commands.log'), 'r');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  try {
    const st = await fh.stat();
    if (!st.isFile()) throw new Error('commands.log is not a file');
    const size = st.size;
    const start = Math.max(0, size - AUDIT_MAX_BYTES);
    const buf = Buffer.alloc(size - start);
    let read = 0;
    while (read < buf.length) {
      const { bytesRead } = await fh.read(buf, read, buf.length - read, start + read);
      if (bytesRead === 0) break;
      read += bytesRead;
    }
    let text = buf.subarray(0, read).toString('utf8');
    // Started mid-file: the first line is probably cut, drop it.
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    return parseAudit(text, deviceId, filter);
  } finally {
    await fh.close();
  }
}
