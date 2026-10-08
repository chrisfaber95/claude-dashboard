import { closeSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { TEAM_HQ_DIR } from './config.ts';
import { TEAM_COLUMNS, type TeamBoard, type TeamColumn, type TeamTicket } from '../shared/types.ts';

// Strictly read-only: only readdirSync / statSync and openSync('r') + readSync, nothing is ever written under the team-hq folder.

const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const MAX_LIST = 20;
const MAX_TITLE = 120;
const MAX_NEEDS = 200;
const MAX_TICKET_BYTES = 8 * 1024;
const MAX_NEEDS_BYTES = 64 * 1024;
const MAX_ENTRIES = 2000;
const CACHE_TTL_MS = 5000;

/** Reads at most `max` bytes from the start of a file (read-only); the fd is always closed. */
function readHead(path: string, max: number): string {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(max);
    let total = 0;
    while (total < max) {
      const n = readSync(fd, buf, total, max - total, total);
      if (n <= 0) break;
      total += n;
    }
    return buf.toString('utf8', 0, total);
  } finally {
    closeSync(fd);
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function mdFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md'))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

function parseTicket(dir: string, file: string): TeamTicket | null {
  try {
    const text = readHead(join(dir, file), MAX_TICKET_BYTES).replace(/^﻿/, '');
    const lines = text.split(/\r?\n/);
    let id: string | null = null;
    if (lines[0]?.trim() === '---') {
      for (let i = 1; i < lines.length && lines[i].trim() !== '---'; i++) {
        const m = lines[i].match(/^id:\s*(.*)$/);
        if (m) {
          id = m[1].trim().replace(/^(["'])(.*)\1$/, '$2');
          break;
        }
      }
    }
    if (id === null || !ID_RE.test(id)) return null;

    let title = '';
    const goal = lines.findIndex((l) => /^##\s+Goal\s*$/i.test(l.trim()));
    if (goal >= 0) {
      for (let i = goal + 1; i < lines.length; i++) {
        const t = lines[i].trim();
        if (!t) continue;
        if (!/^#/.test(t)) title = t.slice(0, MAX_TITLE);
        break;
      }
    }
    if (!title) {
      let slug = file.replace(/\.md$/i, '');
      if (slug.startsWith(`${id}-`)) slug = slug.slice(id.length + 1);
      title = slug.replace(/-/g, ' ').trim().slice(0, MAX_TITLE);
    }
    return { id, title };
  } catch {
    return null;
  }
}

function listTickets(dir: string, files: string[]): TeamTicket[] {
  const out: TeamTicket[] = [];
  for (const f of [...files].sort().slice(0, MAX_ENTRIES)) {
    const t = parseTicket(dir, f);
    if (t) out.push(t);
    if (out.length >= MAX_LIST) break;
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, MAX_LIST);
}

function readNeedsYou(board: string): string[] {
  try {
    const out: string[] = [];
    for (const line of readHead(join(board, 'NEEDS-YOU.md'), MAX_NEEDS_BYTES).split(/\r?\n/)) {
      const m = line.match(/^\s*- \[ \]\s*(.+)$/);
      if (!m) continue;
      const t = m[1].trim().slice(0, MAX_NEEDS);
      if (t) out.push(t);
      if (out.length >= MAX_LIST) break;
    }
    return out;
  } catch {
    return [];
  }
}

const cache = new Map<string, { at: number; value: TeamBoard | null }>();

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
    if (!isDir(dir) || !isDir(board)) return null;
    const counts = {} as Record<TeamColumn, number>;
    const tickets = {} as Record<TeamColumn, TeamTicket[]>;
    for (const col of TEAM_COLUMNS) {
      const colDir = join(board, col);
      const files = mdFiles(colDir);
      counts[col] = files.length;
      tickets[col] = col === 'in-progress' || col === 'review' || col === 'blocked' ? listTickets(colDir, files) : [];
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
