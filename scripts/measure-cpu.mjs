// Measures the average CPU use of an open dashboard tab in a headless Chrome or Edge, over the Chrome DevTools
// Protocol (Node's built-in WebSocket, no dependency). See docs/perf.md.
//
//   node scripts/measure-cpu.mjs [url] [seconds] [viewport] [--browser <path>] [--warmup <seconds>]
//
// url        default http://127.0.0.1:4777
// seconds    measurement window, default 120
// viewport   WIDTHxHEIGHT, default 1920x1080
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Average CPU % of a tab between two samples: main-thread task time that elapsed, divided by wall time.
 * 100 means one core fully busy. Each sample is { taskSeconds, wallSeconds } (TaskDuration from
 * Performance.getMetrics, and a monotonic clock in seconds).
 */
export function cpuPercent(first, last) {
  const wall = last.wallSeconds - first.wallSeconds;
  if (!(wall > 0)) throw new Error('The measurement window must have a positive length');
  const task = last.taskSeconds - first.taskSeconds;
  if (task < 0) throw new Error('TaskDuration went backwards: the tab was reloaded during the window');
  return (task / wall) * 100;
}

/** Median of a list of numbers (mean of the two middle ones for an even count). */
export function median(values) {
  if (!values.length) throw new Error('No values');
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Usual install paths of Chrome and Edge, per platform. */
export function browserCandidates(env = process.env, platform = process.platform) {
  if (platform === 'win32') {
    const roots = [env['ProgramFiles'], env['ProgramFiles(x86)'], env['LOCALAPPDATA']].filter(Boolean);
    const rel = ['Google\\Chrome\\Application\\chrome.exe', 'Microsoft\\Edge\\Application\\msedge.exe'];
    return roots.flatMap((r) => rel.map((p) => join(r, p)));
  }
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
  }
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
}

function parseArgs(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--browser' || argv[i] === '--warmup') {
      if (i + 1 >= argv.length) throw new Error(`${argv[i]} needs a value`);
      opt[argv[i].slice(2)] = argv[++i];
    } else pos.push(argv[i]);
  }
  const url = pos[0] ?? 'http://127.0.0.1:4777';
  const seconds = Number(pos[1] ?? 120);
  const m = /^(\d+)x(\d+)$/.exec(pos[2] ?? '1920x1080');
  const warmup = Number(opt.warmup ?? 15);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('seconds must be a positive number');
  if (!Number.isFinite(warmup) || warmup < 0) throw new Error('--warmup must be a number of seconds, 0 or more');
  if (!m) throw new Error('viewport must look like 1920x1080');
  return { url, seconds, warmup, width: Number(m[1]), height: Number(m[2]), browser: opt.browser };
}

function findBrowser(explicit) {
  if (explicit) {
    if (!existsSync(explicit)) throw new Error(`Browser not found at ${explicit}`);
    return explicit;
  }
  const found = browserCandidates().find((p) => existsSync(p));
  if (!found) {
    throw new Error('No Chrome or Edge found in the usual install paths. Pass --browser <path to chrome.exe or msedge.exe>.');
  }
  return found;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, what, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await sleep(100);
  }
}

/** Minimal CDP client over a WebSocket. */
function cdpClient(ws) {
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(String(ev.data));
    const p = msg.id !== undefined ? pending.get(msg.id) : undefined;
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(`CDP ${p.method}: ${msg.error.message}`));
    else p.resolve(msg.result);
  });
  return (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, { resolve, reject, method });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
}

async function sample(send) {
  const { metrics } = await send('Performance.getMetrics');
  const task = metrics.find((m) => m.name === 'TaskDuration');
  if (!task) throw new Error('Performance.getMetrics returned no TaskDuration');
  return { taskSeconds: task.value, wallSeconds: Number(process.hrtime.bigint()) / 1e9 };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const exe = findBrowser(args.browser);
  const profile = mkdtempSync(join(tmpdir(), 'measure-cpu-'));
  const child = spawn(
    exe,
    [
      '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
      '--no-default-browser-check', '--disable-extensions', `--window-size=${args.width},${args.height}`, 'about:blank',
    ],
    { stdio: 'ignore' },
  );
  try {
    const port = await waitFor(() => {
      if (child.exitCode !== null) throw new Error(`${exe} exited with code ${child.exitCode}`);
      try {
        return readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0] || null;
      } catch {
        return null;
      }
    }, 'the browser debugging port');
    const target = await waitFor(async () => {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      return list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    }, 'a page target');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('Could not open the DevTools WebSocket')), { once: true });
    });
    const send = cdpClient(ws);
    await send('Page.enable');
    await send('Performance.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: args.width, height: args.height, deviceScaleFactor: 1, mobile: args.width < 500,
    });
    await send('Page.navigate', { url: args.url });
    console.error(`Warming up ${args.warmup} s, then measuring ${args.seconds} s at ${args.width}x${args.height} (${exe})`);
    await sleep(args.warmup * 1000);
    const first = await sample(send);
    await sleep(args.seconds * 1000);
    const last = await sample(send);
    ws.close();
    console.log(cpuPercent(first, last).toFixed(2));
  } finally {
    child.kill();
    await sleep(500);
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      // The browser may still hold a file for a moment; the temp dir is harmless.
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(`measure-cpu: ${e.message}`);
    process.exit(1);
  });
}
