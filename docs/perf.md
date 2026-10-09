# Performance: CPU of an open dashboard tab

The dashboard tab stays open all day and the server pushes the full state every 2 s, so its idle CPU use matters.
`scripts/measure-cpu.mjs` measures it repeatably.

## Method

```
node scripts/measure-cpu.mjs [url] [seconds] [viewport] [--browser <path>] [--warmup <seconds>]
node scripts/measure-cpu.mjs http://127.0.0.1:4777 120 1920x1080
```

Defaults: `http://127.0.0.1:4777`, 120 s, `1920x1080`, 15 s warm-up. Start the dashboard first in localhost mode
(no `--lan`, no login), with real `~/.claude` data.

1. Finds Chrome or Edge in the usual install paths (or `--browser <path>`); errors out if there is none.
2. Starts it headless with a throw-away profile and `--remote-debugging-port=0`, and talks to it over the Chrome
   DevTools Protocol with Node's built-in `WebSocket` (no dependency).
3. Sets the viewport (`Emulation.setDeviceMetricsOverride`; mobile mode below 500 px wide), opens the URL, waits for
   the warm-up.
4. Reads `Performance.getMetrics` `TaskDuration` (cumulative seconds of main-thread work of the tab) at the start and
   end of the window. CPU % = task seconds elapsed / wall seconds elapsed x 100 (100 = one core fully busy). Prints
   that number.

The calculation is the pure function `cpuPercent` (unit-tested in `tests/measure-cpu.test.ts`; the test suite never
starts a browser).

Limits: it counts main-thread tasks of the tab only (not GPU, compositor or network processes), headless, on this
PC. Compare before/after on the same PC, with the same data and the same browser; do not read it as total system load.

## Baseline

Commit `20fcd90` (main before the F-004 redesign), Chrome on Windows 11, real `~/.claude` data, localhost server,
3 runs of 120 s each (15 s warm-up).

| Viewport | Run 1 | Run 2 | Run 3 | Median |
|---|---|---|---|---|
| 1920x1080 | 0.63 % | 0.63 % | 0.59 % | **0.63 %** |
| 390x844 | 0.63 % | 0.61 % | 0.62 % | **0.62 %** |
