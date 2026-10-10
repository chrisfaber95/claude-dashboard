import { closeSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { TEAM_HQ_DIR } from '../../config.ts';
import { TEAM_COLUMNS, type TeamBoard, type TeamColumn, type TeamTicket } from '../../../shared/types/index.ts';

// Strictly read-only: only readdirSync / statSync and openSync('r') + readSync, nothing is ever written under the team-hq folder.

const ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const LIST_MAX = 20;
const TITLE_MAX_CHARS = 120;
const NEEDS_MAX_CHARS = 200;
const KILOBYTE = 1024;
const TICKET_MAX_BYTES = 8 * KILOBYTE;
const NEEDS_MAX_BYTES = 64 * KILOBYTE;
const ENTRIES_MAX = 2000;
const CACHE_TTL_MS = 5000;
/** Columns whose tickets are listed in full; the other columns only get a count. */
const LISTED_COLUMNS: readonly TeamColumn[] = ['in-progress', 'review', 'blocked'];
const FRONT_MATTER_FENCE = '---';

interface CachedBoard {
  at: number;
  value: TeamBoard | null;
}

/** Reads at most `max` bytes from the start of a file (read-only); the file descriptor is always closed. */
function readHead(path: string, max: number): string {
  const fileDescriptor = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(max);
    let total = 0;
    while (total < max) {
      const bytesRead = readSync(fileDescriptor, buffer, total, max - total, total);
      if (bytesRead <= 0) break;
      total += bytesRead;
    }
    return buffer.toString('utf8', 0, total);
  } finally {
    closeSync(fileDescriptor);
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function markdownFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** The `id:` of the YAML front matter, or null when there is none. */
function frontMatterId(lines: string[]): string | null {
  if (lines[0]?.trim() !== FRONT_MATTER_FENCE) return null;
  for (let i = 1; i < lines.length && lines[i].trim() !== FRONT_MATTER_FENCE; i++) {
    const match = lines[i].match(/^id:\s*(.*)$/);
    if (match) return match[1].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return null;
}

/** The first text line under the `## Goal` heading, or '' when it is missing or another heading follows. */
function goalTitle(lines: string[]): string {
  const goalIndex = lines.findIndex((line) => /^##\s+Goal\s*$/i.test(line.trim()));
  if (goalIndex < 0) return '';
  for (let i = goalIndex + 1; i < lines.length; i++) {
    const text = lines[i].trim();
    if (!text) continue;
    return /^#/.test(text) ? '' : text.slice(0, TITLE_MAX_CHARS);
  }
  return '';
}

function titleFromFileName(file: string, id: string): string {
  let slug = file.replace(/\.md$/i, '');
  if (slug.startsWith(`${id}-`)) slug = slug.slice(id.length + 1);
  return slug.replace(/-/g, ' ').trim().slice(0, TITLE_MAX_CHARS);
}

function parseTicket(dir: string, file: string): TeamTicket | null {
  try {
    const text = readHead(join(dir, file), TICKET_MAX_BYTES).replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/);
    const id = frontMatterId(lines);
    if (id === null || !ID_PATTERN.test(id)) return null;
    return { id, title: goalTitle(lines) || titleFromFileName(file, id) };
  } catch {
    return null;
  }
}

function compareIds(a: TeamTicket, b: TeamTicket): number {
  if (a.id < b.id) return -1;
  return a.id > b.id ? 1 : 0;
}

function listTickets(dir: string, files: string[]): TeamTicket[] {
  const out: TeamTicket[] = [];
  for (const file of [...files].sort().slice(0, ENTRIES_MAX)) {
    const ticket = parseTicket(dir, file);
    if (ticket) out.push(ticket);
    if (out.length >= LIST_MAX) break;
  }
  return out.sort(compareIds).slice(0, LIST_MAX);
}

function readNeedsYou(board: string): string[] {
  try {
    const out: string[] = [];
    for (const line of readHead(join(board, 'NEEDS-YOU.md'), NEEDS_MAX_BYTES).split(/\r?\n/)) {
      const match = line.match(/^\s*- \[ \]\s*(.+)$/);
      if (!match) continue;
      const item = match[1].trim().slice(0, NEEDS_MAX_CHARS);
      if (item) out.push(item);
      if (out.length >= LIST_MAX) break;
    }
    return out;
  } catch {
    return [];
  }
}

const cache = new Map<string, CachedBoard>();

/** Clears the readTeamBoard cache (for tests). */
export function resetTeamCache(): void {
  cache.clear();
}

/** Summary of the team-hq board (cached 5 s per dir), or null when the folder or its `board/` subfolder doesn't exist. */
export function readTeamBoard(dir: string = TEAM_HQ_DIR): TeamBoard | null {
  const now = Date.now();
  const hit = cache.get(dir);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.value;
  const value = scanTeamBoard(dir);
  cache.set(dir, { at: now, value });
  return value;
}

function scanTeamBoard(dir: string): TeamBoard | null {
  try {
    const board = join(dir, 'board');
    if (!isDirectory(dir) || !isDirectory(board)) return null;
    const counts = {} as Record<TeamColumn, number>;
    const tickets = {} as Record<TeamColumn, TeamTicket[]>;
    for (const column of TEAM_COLUMNS) {
      const columnDir = join(board, column);
      const files = markdownFiles(columnDir);
      counts[column] = files.length;
      tickets[column] = LISTED_COLUMNS.includes(column) ? listTickets(columnDir, files) : [];
    }
    return {
      counts,
      active: { inProgress: tickets['in-progress'], review: tickets.review, blocked: tickets.blocked },
      needsYou: readNeedsYou(board),
    };
  } catch {
    return null;
  }
}
