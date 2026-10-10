import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Enforces docs/code-style.md (team-hq decision 0006): the folder map and the file size cap.

const SOURCE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const MAX_LINES = 300;

/** Folders of the map, per tree. A .ts file under src/client or src/server lives in one of them. */
const FOLDER_MAP: Record<string, string[]> = {
  client: ['app', 'features', 'skins', 'shared'],
  server: ['http', 'auth', 'claude', 'transcripts', 'features'],
};

/** Loose files allowed at the top of a tree: server entry points. */
const ENTRY_POINTS = ['server/main.ts', 'server/server.ts', 'server/config.ts'];

/**
 * Today's files outside the map. This list may only shrink: moving a file into the map removes its line;
 * never add a file here.
 */
const MISPLACED_ALLOWLIST = new Set([
  'client/alerts-logic.ts', 'client/alerts.ts', 'client/app.ts', 'client/audit-logic.ts', 'client/audit.ts',
  'client/boot.ts', 'client/building.ts', 'client/chat-logic.ts', 'client/chat-state.ts', 'client/chat.ts',
  'client/controls.ts', 'client/core.ts', 'client/devices-logic.ts', 'client/devices.ts',
  'client/launch-logic.ts', 'client/login.ts', 'client/mood.ts', 'client/pair.ts', 'client/patch.ts',
  'client/popups-logic.ts', 'client/popups.ts', 'client/qr.ts', 'client/root-scene.ts', 'client/settings.ts',
  'client/skin.ts', 'client/team.ts', 'client/util.ts',
]);

/** Today's files over the cap. This list may only shrink: split a file and remove its line; never add one. */
const OVERSIZED_ALLOWLIST = new Set([
  'client/app.ts', 'client/building.ts', 'client/controls.ts', 'server/server.ts', 'server/transcripts/transcripts.ts',
]);

/** Every .ts file under src/, as a path relative to src/ with forward slashes. */
function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(fullPath);
    return entry.name.endsWith('.ts') ? [relative(SOURCE_ROOT, fullPath).replaceAll('\\', '/')] : [];
  });
}

function isInFolderMap(file: string): boolean {
  if (ENTRY_POINTS.includes(file)) return true;
  const [tree, folder, ...rest] = file.split('/');
  return rest.length > 0 && (FOLDER_MAP[tree] ?? []).includes(folder);
}

function countLines(file: string): number {
  return readFileSync(join(SOURCE_ROOT, file), 'utf8').split('\n').length;
}

const sourceFiles = listSourceFiles(SOURCE_ROOT);
const treeFiles = sourceFiles.filter((file) => file.startsWith('client/') || file.startsWith('server/'));

test('every .ts file under src/client and src/server is in a folder of the map', () => {
  const misplaced = treeFiles.filter((file) => !isInFolderMap(file) && !MISPLACED_ALLOWLIST.has(file));
  assert.deepEqual(misplaced, [], 'put new files in a folder of the map (docs/code-style.md); never extend the allowlist');
});

test('no .ts file under src/ passes the size cap', () => {
  const tooLarge = sourceFiles.filter((file) => countLines(file) > MAX_LINES && !OVERSIZED_ALLOWLIST.has(file));
  assert.deepEqual(tooLarge, [], `split files over ${MAX_LINES} lines; never extend the allowlist`);
});

test('the allowlists only shrink: no stale entries', () => {
  const staleMisplaced = [...MISPLACED_ALLOWLIST].filter((file) => !treeFiles.includes(file) || isInFolderMap(file));
  const staleOversized = [...OVERSIZED_ALLOWLIST].filter((file) => !sourceFiles.includes(file) || countLines(file) <= MAX_LINES);
  assert.deepEqual(staleMisplaced, [], 'moved files must leave MISPLACED_ALLOWLIST');
  assert.deepEqual(staleOversized, [], 'split files must leave OVERSIZED_ALLOWLIST');
});
