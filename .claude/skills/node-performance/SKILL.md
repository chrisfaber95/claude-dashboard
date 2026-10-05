---
name: node-performance
description: "Procedure for diagnosing and fixing Node.js performance problems from measurements: CPU profiles, event-loop delay, heap growth and leaks, slow I/O, unbounded concurrency and missing streaming, verified with before and after numbers. Followed by the node-specialist agent; in a main session, delegate Node performance work to that agent."
argument-hint: "<symptom, endpoint or process to investigate>"
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep]
---

Investigate Node performance of: $ARGUMENTS

Wherever a step says to ask the user: in a main session, ask. When running as the
node-specialist subagent, state the assumption and return the question. Only profile and load
test a local instance. Report only numbers you measured; never estimate gains.

## Steps

1. Pin down the symptom: slow response, high CPU, memory growing, slow startup, or crashes with
   out-of-memory. Get the reproduction: which endpoint or job, with what input and volume.
   Record the Node version and whether it is a development or production build of the app.
2. Take a baseline before changing anything. Start the app locally against a test database and
   mocked or test-mode external services, then measure:
   - request latency under load: `npx autocannon -c <connections> -d <seconds> <url>` (runs
     without installing anything into the project), or the project's own load script
   - event-loop delay: `perf_hooks.monitorEventLoopDelay()` logged temporarily, or the project's
     metrics if it has them
   - memory: `process.memoryUsage()` sampled over time under steady load
   Write the numbers down with the command and conditions.
3. Profile the CPU if time is spent in your own code: run the app with `node --cpu-prof` (a
   `.cpuprofile` file is written on exit), or attach with `node --inspect` and use Chrome
   DevTools. Read the profile for the functions with the most self time. For memory, use
   `node --heap-prof`, or take heap snapshots at two points under load with DevTools and compare
   what grows. Keep profile files in a temp folder, not in the repo.
4. Match the cause to the usual suspects:
   - **event loop blocked**: synchronous file or crypto calls (`readFileSync`, `pbkdf2Sync`),
     huge `JSON.parse` or `JSON.stringify`, catastrophic regular expressions, large loops over
     big arrays. Fix by using the async version, streaming, chunking the work, or moving
     CPU-heavy work to a worker thread.
   - **slow I/O**: N+1 queries, sequential awaits that could run with `Promise.all`, no
     connection pooling, no timeouts, repeated identical lookups that could be cached with a
     bounded cache.
   - **unbounded concurrency**: `Promise.all` over thousands of items. Limit with a small
     concurrency helper or a queue.
   - **buffering instead of streaming**: reading whole files or responses into memory. Use
     streams with `stream.pipeline` so backpressure is respected.
   - **memory leaks**: caches or maps that only grow, event listeners added per request and
     never removed, timers never cleared, closures holding large objects, global arrays of
     requests. Confirm by the heap comparison before fixing.
   - **slow startup**: heavy work at import time, loading all modules eagerly, large JSON
     parsing at boot.
5. Change one thing at a time, the smallest effective fix first. Do not add a dependency or an
   external cache unless the measurements justify it, and say so if they do.
6. Re-measure with the same commands and conditions. Keep a change only if the numbers moved;
   revert it if they did not.
7. Run the project's tests and lint to make sure behavior is unchanged.
8. Report: the symptom, the baseline and final numbers with how they were taken, each change
   and its measured effect, what you tried that did not help, and remaining issues. Name what
   you could not measure (production traffic, real hardware).
