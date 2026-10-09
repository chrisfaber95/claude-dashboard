import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './config.ts';
import { SUMMARY_MODES, type SummaryMode } from '../shared/types.ts';

const FILE = () => join(DATA_DIR, 'settings.json');

/** The saved summary mode; `recap` when the file is missing, mid-write or holds anything else. */
export function getSummaryMode(): SummaryMode {
  try {
    const v = (JSON.parse(readFileSync(FILE(), 'utf8')) as { summary?: unknown }).summary;
    return SUMMARY_MODES.includes(v as SummaryMode) ? (v as SummaryMode) : 'recap';
  } catch {
    return 'recap';
  }
}

/** Saves the mode; false when the value is not a known mode or the file can't be written. */
export function setSummaryMode(mode: unknown): boolean {
  if (!SUMMARY_MODES.includes(mode as SummaryMode)) return false;
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const tmp = FILE() + '.tmp';
    writeFileSync(tmp, JSON.stringify({ summary: mode }));
    renameSync(tmp, FILE());
    return true;
  } catch {
    return false;
  }
}
