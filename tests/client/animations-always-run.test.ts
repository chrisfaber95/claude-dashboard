import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// UI conventions: animations always run (Windows "Animation effects" is off on the user's PC).

const CLIENT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'client');
const FORBIDDEN_RULE = 'prefers-reduced-motion';

/** Every .scss and .vue file under a folder, as a path relative to the client root. */
function listStyleFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) return listStyleFiles(fullPath);
    const isStyleFile = entry.name.endsWith('.scss') || entry.name.endsWith('.vue');
    return isStyleFile ? [relative(CLIENT_ROOT, fullPath).replaceAll('\\', '/')] : [];
  });
}

test('no client stylesheet or component uses prefers-reduced-motion', () => {
  const files = listStyleFiles(CLIENT_ROOT);
  assert.ok(files.length > 0);
  const offenders = files.filter((file) => readFileSync(join(CLIENT_ROOT, file), 'utf8').includes(FORBIDDEN_RULE));
  assert.deepEqual(offenders, []);
});
