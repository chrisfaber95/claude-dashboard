import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

const { CommandError, resolveClaudeBin, startTask } = await import('../src/server/claude-cli.ts');

const NAME = process.platform === 'win32' ? 'claude.exe' : 'claude';
const KEYS = ['PATH', 'CLAUDE_BIN', 'CLAUDE_BIN_ARGS', 'HOME', 'USERPROFILE'] as const;

let tmp = '';
let home = '';
let cwd = '';
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  cwd = process.cwd();
  tmp = mkdtempSync(join(tmpdir(), 'claude-bin-'));
  home = join(tmp, 'home');
  mkdirSync(home);
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.CLAUDE_BIN;
  delete process.env.CLAUDE_BIN_ARGS;
  process.env.PATH = '';
});

afterEach(() => {
  process.chdir(cwd);
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(tmp, { recursive: true, force: true });
});

function dir(name: string): string {
  const d = join(tmp, name);
  mkdirSync(d, { recursive: true });
  return d;
}

function fakeBin(d: string): string {
  const p = join(d, NAME);
  writeFileSync(p, 'placeholder', { mode: 0o755 });
  return p;
}

function vscodeBin(version: string, withBin = true): string {
  const d = join(home, '.vscode', 'extensions', `anthropic.claude-code-${version}-win32-x64`, 'resources', 'native-binary');
  mkdirSync(d, { recursive: true });
  return withBin ? fakeBin(d) : join(d, NAME);
}

test('CLAUDE_BIN wins over PATH and VS Code, and CLAUDE_BIN_ARGS is parsed', () => {
  fakeBin(dir('pathdir'));
  vscodeBin('2.0.0');
  process.env.PATH = join(tmp, 'pathdir');
  process.env.CLAUDE_BIN = join(tmp, 'custom-bin');
  process.env.CLAUDE_BIN_ARGS = JSON.stringify(['script.mjs', '--x']);
  assert.deepEqual(resolveClaudeBin(), { bin: join(tmp, 'custom-bin'), prefix: ['script.mjs', '--x'] });
});

test('CLAUDE_BIN without args gives an empty prefix', () => {
  process.env.CLAUDE_BIN = 'some-bin';
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
  process.env.PATH = join(tmp, 'p');
  assert.equal(resolveClaudeBin()?.bin, bin);
});

test('a quoted PATH entry is accepted', () => {
  const bin = fakeBin(dir('quoted'));
  process.env.PATH = `"${join(tmp, 'quoted')}"`;
  assert.equal(resolveClaudeBin()?.bin, bin);
});

test('a relative PATH entry is ignored', () => {
  const d = dir('rel');
  fakeBin(d);
  process.chdir(d);
  process.env.PATH = ['.', ''].join(delimiter);
  assert.equal(resolveClaudeBin(), null);
});

test('a drive-less or UNC PATH entry is ignored on Windows', { skip: process.platform !== 'win32' }, () => {
  const d = dir('driveless');
  fakeBin(d);
  process.env.PATH = [d.slice(2), `\\\\127.0.0.1\\${d[0]}$${d.slice(2)}`].join(delimiter);
  process.chdir(d);
  assert.equal(resolveClaudeBin(), null);
});

test('a directory named like the binary is not accepted', () => {
  const d = dir('dirbin');
  mkdirSync(join(d, NAME));
  process.env.PATH = d;
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
  await assert.rejects(startTask(tmp, 'x', 'plan'), (e: unknown) => {
    assert.ok(e instanceof CommandError);
    assert.equal(e.status, 500);
    assert.equal(e.message, 'Claude CLI not found (set CLAUDE_BIN)');
    return true;
  });
});
