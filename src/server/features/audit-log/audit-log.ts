import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR } from '../../config.ts';
import { isRecord } from '../json/json-guards.ts';
import type { AuditEntry } from '../../../shared/types/index.ts';

// The only fields that ever leave `commands.log` through the API (never `ip`, ids of targets, names, codes).
export type { AuditEntry };

/** `GET /api/audit` returns this many entries at most. */
export const AUDIT_MAX_ENTRIES = 200;
/** `GET /api/launches` returns this many launches at most. */
export const LAUNCHES_MAX = 50;
/** `GET /api/approvals` returns this many entries at most. */
export const APPROVALS_MAX = 50;
/** At most this much of the end of the file is read. */
export const AUDIT_MAX_BYTES = 1024 * 1024;
const FIELD_MAX_CHARS = 200;
const TIMESTAMP_MAX_CHARS = 40;
const ACTION_MAX_CHARS = 40;
const DEVICE_MAX_CHARS = 80;
const DEVICE_ID_MAX_CHARS = 64;
const TARGET_MAX_CHARS = 120;
const GOAL_MAX_CHARS = 500;
const TOOL_MAX_CHARS = 100;
const REQUEST_TEXT_MAX_CHARS = 500;
const OUTCOME_MAX_CHARS = 20;
const TARGET_FIELDS = ['project', 'session', 'mode'] as const;

const ID_LIKE = /^(?:pc|[0-9a-f]{12})$/;

function stringField(value: unknown, max = FIELD_MAX_CHARS): string | undefined {
  return typeof value === 'string' ? value.slice(0, max) : undefined;
}

/** One parsed log line reduced to the allowlisted fields, or null when it is not an entry. */
export function toAuditEntry(raw: unknown): AuditEntry | null {
  if (!isRecord(raw)) return null;
  const fields = raw;
  const ts = stringField(fields.ts, TIMESTAMP_MAX_CHARS);
  const action = stringField(fields.action, ACTION_MAX_CHARS);
  if (!ts || !action) return null;
  let device = stringField(fields.device, DEVICE_MAX_CHARS);
  let deviceId = stringField(fields.deviceId, DEVICE_ID_MAX_CHARS);
  // Entries written before device names existed carried the device id in `device`.
  if (deviceId === undefined && device !== undefined && ID_LIKE.test(device)) {
    deviceId = device;
    device = undefined;
  }
  const entry: AuditEntry = { ts, action };
  if (device !== undefined) entry.device = device;
  if (deviceId !== undefined) entry.deviceId = deviceId;
  for (const field of TARGET_FIELDS) {
    const value = stringField(fields[field], TARGET_MAX_CHARS);
    if (value !== undefined) entry[field] = value;
  }
  if (typeof fields.ok === 'boolean') entry.ok = fields.ok;
  const prompt = stringField(fields.prompt);
  if (prompt !== undefined) entry.prompt = prompt;
  const goal = stringField(fields.goal, GOAL_MAX_CHARS);
  if (goal !== undefined) entry.goal = goal;
  const tool = stringField(fields.tool, TOOL_MAX_CHARS);
  if (tool !== undefined) entry.tool = tool;
  const text = stringField(fields.text, REQUEST_TEXT_MAX_CHARS);
  if (text !== undefined) entry.text = text;
  const outcome = stringField(fields.outcome, OUTCOME_MAX_CHARS);
  if (outcome !== undefined) entry.outcome = outcome;
  const { notesLength } = fields;
  if (typeof notesLength === 'number' && Number.isSafeInteger(notesLength) && notesLength >= 0) entry.notesLength = notesLength;
  return entry;
}

/** Narrowing for `parseAudit` and `readAudit`. */
export interface AuditFilter {
  /** Only entries with this action. */
  action?: string;
  limit?: number;
}

function parseJson(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

/** Parse log text: newest first, malformed lines skipped, optionally only one device or action, at most `limit` entries. */
export function parseAudit(text: string, deviceId?: string, { action, limit = AUDIT_MAX_ENTRIES }: AuditFilter = {}): AuditEntry[] {
  const out: AuditEntry[] = [];
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    const entry = toAuditEntry(parseJson(line));
    if (!entry) continue;
    if (deviceId !== undefined && entry.deviceId !== deviceId) continue;
    if (action !== undefined && entry.action !== action) continue;
    out.push(entry);
  }
  return out;
}

/** The newest audit entries from `<DATA_DIR>/commands.log`, reading at most its last megabyte. A missing file is empty. */
export async function readAudit(deviceId?: string, filter?: AuditFilter): Promise<AuditEntry[]> {
  let handle;
  try {
    handle = await open(join(DATA_DIR, 'commands.log'), 'r');
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return [];
    throw error;
  }
  try {
    const fileStat = await handle.stat();
    if (!fileStat.isFile()) throw new Error('commands.log is not a file');
    const start = Math.max(0, fileStat.size - AUDIT_MAX_BYTES);
    const buffer = Buffer.alloc(fileStat.size - start);
    let bytesFilled = 0;
    while (bytesFilled < buffer.length) {
      const { bytesRead } = await handle.read(buffer, bytesFilled, buffer.length - bytesFilled, start + bytesFilled);
      if (bytesRead === 0) break;
      bytesFilled += bytesRead;
    }
    let text = buffer.subarray(0, bytesFilled).toString('utf8');
    // Started mid-file: the first line is probably cut, drop it.
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    return parseAudit(text, deviceId, filter);
  } finally {
    await handle.close();
  }
}
