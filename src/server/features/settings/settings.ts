import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../../config.ts';
import { isRecord } from '../json/json-guards.ts';
import { SUMMARY_MODES, type SummaryMode } from '../../../shared/types/index.ts';

const FILE = () => join(DATA_DIR, 'settings.json');

function isSummaryMode(value: unknown): value is SummaryMode {
  return SUMMARY_MODES.some((mode) => mode === value);
}

/** The saved summary mode; `recap` when the file is missing, mid-write or holds anything else. */
export function getSummaryMode(): SummaryMode {
  try {
    const stored: unknown = JSON.parse(readFileSync(FILE(), 'utf8'));
    return isRecord(stored) && isSummaryMode(stored.summary) ? stored.summary : 'recap';
  } catch {
    return 'recap';
  }
}

/** Saves the mode; false when the value is not a known mode or the file can't be written. */
export function setSummaryMode(mode: unknown): boolean {
  if (!isSummaryMode(mode)) return false;
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const tempPath = FILE() + '.tmp';
    writeFileSync(tempPath, JSON.stringify({ summary: mode }));
    renameSync(tempPath, FILE());
    return true;
  } catch {
    return false;
  }
}
