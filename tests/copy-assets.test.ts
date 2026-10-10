import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// The script is plain .mjs without types; a dynamic import of a computed URL keeps typecheck happy without touching scripts/.
const scriptUrl = pathToFileURL(join(import.meta.dirname, '..', 'scripts', 'copy-assets.mjs')).href;

const VALID_SVG = '<svg xmlns="http://www.w3.org/2000/svg"/>';

/** Runs `body` inside a temp project dir (cwd switched to it), then restores cwd and cleans up. */
async function inProject(body: (dir: string, outside: string, copyAssets: () => void) => void | Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'copy-assets-'));
  const outside = mkdtempSync(join(tmpdir(), 'copy-assets-outside-'));
  const prev = process.cwd();
  try {
    mkdirSync(join(dir, 'src/client/fonts'), { recursive: true });
    mkdirSync(join(dir, 'src/client/skins/root'), { recursive: true });
    process.chdir(dir);
    const { copyAssets } = (await import(scriptUrl)) as { copyAssets: () => void };
    await body(dir, outside, copyAssets);
  } finally {
    process.chdir(prev);
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
}

test('copyAssets copies only allowlisted extensions and skips symlinks and junctions', async () => {
  await inProject((dir, outside, copyAssets) => {
    writeFileSync(join(dir, 'src/client/fonts/a.woff2'), 'font');
    writeFileSync(join(dir, 'src/client/fonts/LICENSE.txt'), 'license');
    writeFileSync(join(dir, 'src/client/fonts/evil.js'), 'alert(1)');
    writeFileSync(join(dir, 'src/client/skins/root/x.svg'), VALID_SVG);
    writeFileSync(join(dir, 'src/client/skins/root/y.html'), '<script>alert(1)</script>');

    // A directory junction needs no privilege on Windows (symlinkSync type 'junction'); lstat reports it as a symlink.
    writeFileSync(join(outside, 'secret.svg'), VALID_SVG);
    symlinkSync(outside, join(dir, 'src/client/skins/root/linked'), 'junction');

    copyAssets();

    assert.deepEqual(readdirSync(join(dir, 'public/fonts')).sort(), ['LICENSE.txt', 'a.woff2']);
    assert.deepEqual(readdirSync(join(dir, 'public/root')).sort(), ['x.svg']);
    assert.equal(existsSync(join(dir, 'public/root/linked')), false, 'junction must not be copied');
  });
});

test('copyAssets throws when an SVG fails the check', async () => {
  await inProject((dir, _outside, copyAssets) => {
    writeFileSync(join(dir, 'src/client/skins/root/bad.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    assert.throws(() => copyAssets(), /failed the SVG check/);
  });
});

test('copyAssets removes stale files from the target before copying', async () => {
  await inProject((dir, _outside, copyAssets) => {
    writeFileSync(join(dir, 'src/client/skins/root/x.svg'), VALID_SVG);
    mkdirSync(join(dir, 'public/root'), { recursive: true });
    mkdirSync(join(dir, 'public/fonts'), { recursive: true });
    writeFileSync(join(dir, 'public/root/stale.svg'), VALID_SVG);
    writeFileSync(join(dir, 'public/fonts/stale.woff2'), 'old');

    copyAssets();

    assert.deepEqual(readdirSync(join(dir, 'public/root')), ['x.svg']);
    assert.equal(existsSync(join(dir, 'public/fonts/stale.woff2')), false);
  });
});
