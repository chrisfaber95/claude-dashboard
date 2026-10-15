# Performance: CPU of an open dashboard tab

The dashboard tab stays open all day and the server pushes the full state every 2 s, so its idle CPU use matters.
`scripts/measure-cpu.mjs` measures it repeatably.

## Method

```
node scripts/measure-cpu.mjs [url] [seconds] [viewport] [--browser <path>] [--warmup <seconds>] [--popup <id>]
node scripts/measure-cpu.mjs http://127.0.0.1:4777 120 1920x1080
```

Defaults: `http://127.0.0.1:4777`, 120 s, `1920x1080`, 15 s warm-up, no popup (`--popup <id>` clicks that popup's bar button after load, before the warm-up, and fails if it cannot open). Start the dashboard first in localhost mode
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

## After F-004

Commit `230235b` (main after T-028 and T-037), same PC, browser, method, runs and viewports as the baseline: Chrome on
Windows 11, real `~/.claude` data, localhost server on port 4790 with commands off, 3 runs of 120 s each (15 s
warm-up).

| Viewport | Run 1 | Run 2 | Run 3 | Median | Baseline median |
|---|---|---|---|---|---|
| 1920x1080 | 0.15 % | 0.16 % | 0.16 % | **0.16 %** | 0.63 % |
| 390x844 | 0.10 % | 0.10 % | 0.10 % | **0.10 %** | 0.62 % |

Both medians are lower than the baseline. An earlier measurement on `a5190ca` (T-028, before T-037) gave 0.67 % at
1920x1080, not lower: the patcher re-walked every section, including hidden popups, on each push. T-037 skips unchanged
sections and closed popups, which is where the drop comes from. The `~/.claude` data differs from the baseline day, so
treat the ratio as indicative, not exact.

## Before F-007

Commit `cab3b0b` (main before T-091), same PC and browser as F-004: Chrome on Windows 11, real `~/.claude` data,
localhost server on port 4790 with commands off, 3 runs of 120 s each (15 s warm-up). The popup is the Session
communication popup, opened with `--popup comms` after load and before the warm-up. The popup-closed runs were taken in
the same sitting, straight after the popup-open runs.

```
node scripts/measure-cpu.mjs http://127.0.0.1:4790 120 1920x1080 --popup comms
```

| Viewport | Popup | Run 1 | Run 2 | Run 3 | Median |
|---|---|---|---|---|---|
| 1920x1080 | comms open | 0.29 % | 0.22 % | 0.25 % | **0.25 %** |
| 1920x1080 | closed | 0.18 % | 0.18 % | 0.21 % | **0.18 %** |
| 390x844 | comms open | 0.12 % | 0.20 % | 0.18 % | **0.18 %** |
| 390x844 | closed | 0.12 % | 0.08 % | 0.10 % | **0.10 %** |

The open popup costs about 0.07 to 0.08 points over the closed state. The closed numbers differ slightly from the
"After F-004" table (0.16 % and 0.10 %) because the data and sitting differ; compare F-007 against the open-popup rows.

## After F-007

Commit `0d5b898` (main after T-091), same PC and browser as "Before F-007": Chrome on Windows 11, real `~/.claude`
data, localhost server on port 4790 with commands off. Shorter runs than before, as the ticket asked: 60 s each (15 s
warm-up), 3 finished runs per row, taken in one sitting (the popup-closed phone runs, then popup open, and so on). The
popup is the Session communication popup (`--popup comms`), no postman moving.

| Viewport | Popup | Run 1 | Run 2 | Run 3 | Median |
|---|---|---|---|---|---|
| 1920x1080 | comms open | 0.24 % | 0.21 % | 0.24 % | **0.24 %** |
| 1920x1080 | closed | 0.21 % | 0.15 % | 0.16 % | **0.16 %** |
| 390x844 | comms open | 0.24 % | 0.18 % | 0.25 % | **0.24 %** |
| 390x844 | closed | 0.14 % | 0.15 % | 0.15 % | **0.15 %** |

- Open versus closed: +0.08 points at 1920x1080 and +0.09 at 390x844, both within the 0.1 point limit. Open-popup
  medians equal or are below "Before F-007" (0.25 % and 0.18 %) at desktop, and 0.06 points above it on the phone.
- Closed at 1920x1080 is 0.16 %, the F-004 level. Closed at 390x844 is 0.15 %, above the 0.10 % of F-004 and "Before
  F-007". As a control, main before T-091 (`cab3b0b`) was measured in the same sitting with 2 runs of 60 s: 0.15 % and
  0.16 % at 1920x1080, 0.12 % and 0.15 % at 390x844. So the phone-closed rise is also present without T-091 and
  looks like PC and data drift, not a regression; it is not proven with so few runs.
- Not run: the 120 s runs of earlier sections. CPU measurement was stopped by the user's decision on 2026-10-15.
