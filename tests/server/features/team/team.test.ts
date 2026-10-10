// Reading the team-hq board: ticket counts, lists, title fallback and malformed tickets.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeFixture } from '../../../helpers.ts';

const missingHq = join(tmpdir(), 'claude-dash-no-such-team-hq');
process.env.TEAM_HQ_DIR = missingHq;
makeFixture();
const { readTeamBoard, resetTeamCache } = await import('../../../../src/server/features/team/team.ts');
const { buildState } = await import('../../../../src/server/transcripts/state.ts');

const made: string[] = [];
after(() => {
  for (const directory of made) rmSync(directory, { recursive: true, force: true });
});

function newHq(): string {
  const directory = mkdtempSync(join(tmpdir(), 'claude-dash-hq-'));
  made.push(directory);
  return directory;
}

function ticket(hq: string, col: string, file: string, id: string | null, goal?: string): void {
  const dir = join(hq, 'board', col);
  mkdirSync(dir, { recursive: true });
  const front = id === null ? '' : `---\nid: ${id}\nstatus: ${col}\n---\n\n`;
  writeFileSync(join(dir, file), `${front}# Ticket\n\n${goal ? `## Goal\n\n${goal}\n` : '## Notes\n\nnothing\n'}`);
}

function snapshot(root: string): string[] {
  const out: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const filePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        out.push(`D ${filePath} ${statSync(filePath).mtimeMs}`);
        walk(filePath);
      } else {
        out.push(`F ${filePath} ${statSync(filePath).mtimeMs} ${readFileSync(filePath, 'utf8')}`);
      }
    }
  };
  walk(root);
  return out.sort();
}

test('returns null when the folder or its board/ is missing', () => {
  assert.equal(readTeamBoard(missingHq), null);
  assert.equal(readTeamBoard(newHq()), null);
});

test('counts tickets per column; a missing column counts 0', () => {
  const hq = newHq();
  ticket(hq, 'backlog', 'T-001-a.md', 'T-001', 'A');
  ticket(hq, 'backlog', 'T-002-b.md', 'T-002', 'B');
  ticket(hq, 'done', 'T-003-c.md', 'T-003', 'C');
  writeFileSync(join(hq, 'board', 'backlog', 'notes.txt'), 'not a ticket');
  const b = readTeamBoard(hq)!;
  assert.deepEqual(b.counts, { backlog: 2, ready: 0, 'in-progress': 0, review: 0, done: 1, blocked: 0 });
  assert.deepEqual(b.active, { inProgress: [], review: [], blocked: [] });
});

test('lists id and title for in-progress, review and blocked only', () => {
  const hq = newHq();
  ticket(hq, 'in-progress', 'T-010-x.md', 'T-010', 'Build the thing');
  ticket(hq, 'review', 'T-011-y.md', 'T-011', 'Review the thing');
  ticket(hq, 'blocked', 'T-012-z.md', 'T-012', 'Unblock the thing');
  ticket(hq, 'ready', 'T-013-r.md', 'T-013', 'Not listed');
  const b = readTeamBoard(hq)!;
  assert.deepEqual(b.active.inProgress, [{ id: 'T-010', title: 'Build the thing' }]);
  assert.deepEqual(b.active.review, [{ id: 'T-011', title: 'Review the thing' }]);
  assert.deepEqual(b.active.blocked, [{ id: 'T-012', title: 'Unblock the thing' }]);
  assert.equal(b.counts.ready, 1);
});

test('title falls back to the filename slug without the id prefix', () => {
  const hq = newHq();
  ticket(hq, 'in-progress', 'T-020-fix-the-login-bug.md', 'T-020');
  assert.deepEqual(readTeamBoard(hq)!.active.inProgress, [{ id: 'T-020', title: 'fix the login bug' }]);
});

test('malformed tickets are skipped from the list without throwing', () => {
  const hq = newHq();
  ticket(hq, 'in-progress', 'T-030-ok.md', 'T-030', 'Fine');
  ticket(hq, 'in-progress', 'no-front.md', null, 'No front matter');
  ticket(hq, 'in-progress', 'bad-id.md', 'bad id with spaces!', 'Bad');
  ticket(hq, 'in-progress', 'long-id.md', 'x'.repeat(33), 'Too long');
  writeFileSync(join(hq, 'board', 'in-progress', 'empty.md'), '');
  mkdirSync(join(hq, 'board', 'in-progress', 'dir.md'));
  const b = readTeamBoard(hq)!;
  assert.deepEqual(b.active.inProgress, [{ id: 'T-030', title: 'Fine' }]);
  assert.equal(b.counts['in-progress'], 5);
});

test('lists are sorted by id and capped at 20', () => {
  const hq = newHq();
  for (let i = 25; i >= 1; i--) {
    const id = `T-${String(i).padStart(3, '0')}`;
    ticket(hq, 'review', `${id}.md`, id, `Goal ${i}`);
  }
  const b = readTeamBoard(hq)!;
  assert.equal(b.counts.review, 25);
  assert.equal(b.active.review.length, 20);
  assert.deepEqual(b.active.review.map((nowMs) => nowMs.id), Array.from({ length: 20 }, (_, i) => `T-${String(i + 1).padStart(3, '0')}`));
});

test('needsYou returns only unticked checkbox lines', () => {
  const hq = newHq();
  mkdirSync(join(hq, 'board'), { recursive: true });
  writeFileSync(
    join(hq, 'board', 'NEEDS-YOU.md'),
    ['# Needs you', '', '- [ ] approve the plan', '- [x] already done', '- plain bullet', 'free text', '  - [ ] indented one', '- [ ]', ''].join('\r\n'),
  );
  assert.deepEqual(readTeamBoard(hq)!.needsYou, ['approve the plan', 'indented one']);
});

test('missing NEEDS-YOU.md gives an empty list', () => {
  const hq = newHq();
  mkdirSync(join(hq, 'board'), { recursive: true });
  assert.deepEqual(readTeamBoard(hq)!.needsYou, []);
});

test('reading the board changes nothing on disk', () => {
  const hq = newHq();
  ticket(hq, 'in-progress', 'T-040-a.md', 'T-040', 'A');
  ticket(hq, 'review', 'T-041-b.md', 'T-041');
  ticket(hq, 'done', 'T-042-c.md', 'T-042', 'C');
  writeFileSync(join(hq, 'board', 'NEEDS-YOU.md'), '- [ ] one\n');
  const before = snapshot(hq);
  readTeamBoard(hq);
  assert.deepEqual(snapshot(hq), before);
});

test('buildState exposes team, null when TEAM_HQ_DIR points nowhere', () => {
  const state = buildState();
  assert.ok('team' in state);
  assert.equal(state.team, null);
});

test('ticket larger than 8 KB still parses when the front matter is in the head', () => {
  const hq = newHq();
  const dir = join(hq, 'board', 'in-progress');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'T-050-big.md'), `---\nid: T-050\n---\n\n## Goal\n\nBig one\n\n${'x'.repeat(20000)}\n`);
  assert.deepEqual(readTeamBoard(hq)!.active.inProgress, [{ id: 'T-050', title: 'Big one' }]);
});

test('ticket whose id lies beyond the 8 KB head is skipped', () => {
  const hq = newHq();
  const dir = join(hq, 'board', 'in-progress');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'T-051-late.md'), `---\nstatus: x\npad: ${'y'.repeat(9000)}\nid: T-051\n---\n`);
  const b = readTeamBoard(hq)!;
  assert.deepEqual(b.active.inProgress, []);
  assert.equal(b.counts['in-progress'], 1);
});

test('oversized NEEDS-YOU.md is truncated without throwing', () => {
  const hq = newHq();
  mkdirSync(join(hq, 'board'), { recursive: true });
  const filler = '- plain line\n'.repeat(6000);
  writeFileSync(join(hq, 'board', 'NEEDS-YOU.md'), `- [ ] early\n${filler}- [ ] beyond the cap\n`);
  assert.deepEqual(readTeamBoard(hq)!.needsYou, ['early']);
});

test('CRLF front matter parses', () => {
  const hq = newHq();
  const dir = join(hq, 'board', 'review');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'T-052.md'), '---\r\nid: T-052\r\nstatus: review\r\n---\r\n\r\n## Goal\r\n\r\nWindows line endings\r\n');
  assert.deepEqual(readTeamBoard(hq)!.active.review, [{ id: 'T-052', title: 'Windows line endings' }]);
});

test('readTeamBoard is cached within the TTL and refreshes after resetTeamCache()', () => {
  const hq = newHq();
  ticket(hq, 'in-progress', 'T-060-a.md', 'T-060', 'First');
  const first = readTeamBoard(hq);
  assert.equal(readTeamBoard(hq), first);
  ticket(hq, 'in-progress', 'T-061-b.md', 'T-061', 'Second');
  assert.equal(readTeamBoard(hq)!.active.inProgress.length, 1);
  resetTeamCache();
  const fresh = readTeamBoard(hq)!;
  assert.notEqual(fresh, first);
  assert.equal(fresh.active.inProgress.length, 2);
});
