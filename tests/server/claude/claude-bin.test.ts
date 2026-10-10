// How claude.exe is found: environment override, PATH and the VS Code extension folder.
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

const claudeCli = await import('../../../src/server/claude/claude-cli.ts');
const { resolveClaudeBin, startTask } = claudeCli;

const NAME = process.platform === 'win32' ? 'claude.exe' : 'claude';
const KEYS = ['PATH', 'CLAUDE_BIN', 'CLAUDE_BIN_ARGS', 'HOME', 'USERPROFILE'] as const;

let temporaryDirectory = '';
let home = '';
let cwd = '';
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  cwd = process.cwd();
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'claude-bin-'));
  home = join(temporaryDirectory, 'home');
  mkdirSync(home);
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.CLAUDE_BIN;
  delete process.env.CLAUDE_BIN_ARGS;
  process.env.PATH = '';
});

afterEach(() => {
  process.chdir(cwd);
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

function dir(name: string): string {
  const directory = join(temporaryDirectory, name);
  mkdirSync(directory, { recursive: true });
  return directory;
}

function fakeBin(directory: string): string {
  const filePath = join(directory, NAME);
  writeFileSync(filePath, 'placeholder', { mode: 0o755 });
  return filePath;
}

function vscodeBin(version: string, withBin = true): string {
  const directory = join(home, '.vscode', 'extensions', `anthropic.claude-code-${version}-win32-x64`, 'resources', 'native-binary');
  mkdirSync(directory, { recursive: true });
  return withBin ? fakeBin(directory) : join(directory, NAME);
}

test('CLAUDE_BIN wins over PATH and VS Code, and CLAUDE_BIN_ARGS is parsed', () => {
  fakeBin(dir('pathdir'));
  vscodeBin('2.0.0');
  process.env.PATH = join(temporaryDirectory, 'pathdir');
  process.env.CLAUDE_BIN = join(temporaryDirectory, 'custom-bin');
  process.env.CLAUDE_BIN_ARGS = JSON.stringify(['script.mjs', '--x']);
  assert.deepEqual(resolveClaudeBin(), { bin: join(temporaryDirectory, 'custom-bin'), prefix: ['script.mjs', '--x'] });
});

test('CLAUDE_BIN without args gives an empty prefix', () => {
  process.env.CLAUDE_BIN = 'some-bin';
  assert.deepEqual(resolveClaudeBin(), { bin: 'some-bin', prefix: [] });
});

const INVALID_BIN_ARGS = ['not json {', '"script.mjs"', '{"a":1}', 'null', '[1, 2]', '["ok", null]', '[["nested"]]'];

for (const invalid of INVALID_BIN_ARGS) {
  test(`an invalid CLAUDE_BIN_ARGS is refused with a fixed error: ${invalid}`, async () => {
    process.env.CLAUDE_BIN = process.execPath;
    process.env.CLAUDE_BIN_ARGS = invalid;
    assert.throws(() => resolveClaudeBin(), (entry: unknown) => {
      assert.ok(entry instanceof claudeCli.CommandError);
      assert.equal(entry.status, 500);
      assert.equal(entry.message, 'CLAUDE_BIN_ARGS must be a JSON array of strings');
      return true;
    });
    await assert.rejects(startTask(temporaryDirectory, 'x', 'plan'), (entry: unknown) => {
      assert.ok(entry instanceof claudeCli.CommandError);
      assert.equal(entry.message, 'CLAUDE_BIN_ARGS must be a JSON array of strings');
      return true;
    });
  });
}

test('an empty CLAUDE_BIN_ARGS array is a valid empty prefix', () => {
  process.env.CLAUDE_BIN = 'some-bin';
  process.env.CLAUDE_BIN_ARGS = '[]';
  assert.deepEqual(resolveClaudeBin(), { bin: 'some-bin', prefix: [] });
});

test('finds the binary in the second PATH dir', () => {
  const a = dir('a');
  const b = dir('b');
  const bin = fakeBin(b);
  process.env.PATH = [a, b].join(delimiter);
  assert.deepEqual(resolveClaudeBin(), { bin, prefix: [] });
});

test('PATH wins over a VS Code extension binary', () => {
  vscodeBin('2.0.0');
  const bin = fakeBin(dir('p'));
  process.env.PATH = join(temporaryDirectory, 'p');
  assert.equal(resolveClaudeBin()?.bin, bin);
});

test('a quoted PATH entry is accepted', () => {
  const bin = fakeBin(dir('quoted'));
  process.env.PATH = `"${join(temporaryDirectory, 'quoted')}"`;
  assert.equal(resolveClaudeBin()?.bin, bin);
});

test('a relative PATH entry is ignored', () => {
  const directory = dir('rel');
  fakeBin(directory);
  process.chdir(directory);
  process.env.PATH = ['.', ''].join(delimiter);
  assert.equal(resolveClaudeBin(), null);
});

test('a drive-less or UNC PATH entry is ignored on Windows', { skip: process.platform !== 'win32' }, () => {
  const directory = dir('driveless');
  fakeBin(directory);
  process.env.PATH = [directory.slice(2), `\\\\127.0.0.1\\${directory[0]}$${directory.slice(2)}`].join(delimiter);
  process.chdir(directory);
  assert.equal(resolveClaudeBin(), null);
});

test('a directory named like the binary is not accepted', () => {
  const directory = dir('dirbin');
  mkdirSync(join(directory, NAME));
  process.env.PATH = directory;
  assert.equal(resolveClaudeBin(), null);
});

test('VS Code fallback picks the newest version numerically', () => {
  vscodeBin('2.0.9');
  const newest = vscodeBin('2.0.10');
  vscodeBin('1.9.99');
  process.env.PATH = dir('empty');
  assert.equal(resolveClaudeBin()?.bin, newest);
});

test('VS Code fallback skips a newest dir without the binary', () => {
  const older = vscodeBin('2.0.9');
  vscodeBin('2.1.0', false);
  process.env.PATH = dir('empty');
  assert.equal(resolveClaudeBin()?.bin, older);
});

test('returns null when nothing is found', () => {
  process.env.PATH = dir('empty');
  assert.equal(resolveClaudeBin(), null);
});

test('commands fail with the unchanged not-found error when nothing is found', async () => {
  process.env.PATH = dir('empty');
  await assert.rejects(startTask(temporaryDirectory, 'x', 'plan'), (entry: unknown) => {
    assert.ok(entry instanceof claudeCli.CommandError);
    assert.equal(entry.status, 500);
    assert.equal(entry.message, 'Claude CLI not found (set CLAUDE_BIN)');
    return true;
  });
});
