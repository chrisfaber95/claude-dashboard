import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// The script is plain .mjs without types; a dynamic import of a computed URL keeps typecheck happy.
const scriptUrl = pathToFileURL(join(import.meta.dirname, '..', 'scripts', 'measure-cpu.mjs')).href;
const { cpuPercent, median, browserCandidates } = await import(scriptUrl);

test('cpuPercent divides task time by wall time', () => {
  const pct = cpuPercent({ taskSeconds: 1, wallSeconds: 100 }, { taskSeconds: 4, wallSeconds: 160 });
  assert.equal(pct, 5);
});

test('cpuPercent is 0 for an idle tab', () => {
  assert.equal(cpuPercent({ taskSeconds: 2, wallSeconds: 0 }, { taskSeconds: 2, wallSeconds: 10 }), 0);
});

test('cpuPercent rejects an empty window and a reloaded tab', () => {
  assert.throws(() => cpuPercent({ taskSeconds: 0, wallSeconds: 5 }, { taskSeconds: 1, wallSeconds: 5 }), /positive length/);
  assert.throws(() => cpuPercent({ taskSeconds: 3, wallSeconds: 0 }, { taskSeconds: 1, wallSeconds: 10 }), /backwards/);
});

test('median handles odd, even and unsorted input', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.throws(() => median([]));
});

test('browserCandidates lists Chrome and Edge under the Windows install roots', () => {
  const list: string[] = browserCandidates({ ProgramFiles: 'C:\\PF', 'ProgramFiles(x86)': 'C:\\PF86' }, 'win32');
  assert.ok(list.some((p) => p.endsWith('chrome.exe') && p.startsWith('C:\\PF')));
  assert.ok(list.some((p) => p.endsWith('msedge.exe') && p.startsWith('C:\\PF86')));
});
