---
name: review-node
description: "Procedure for reviewing Node.js code for correctness and safety at the runtime level: promise and async handling, error propagation, streams and backpressure, process lifecycle and shutdown, child processes, input handling and package configuration, with severity-ranked findings. Followed by the node-specialist agent; in a main session, delegate Node code review to that agent."
argument-hint: "<files, directory or diff to review>"
allowed-tools: [Read, Glob, Grep, Bash]
---

Review Node code: $ARGUMENTS

Wherever a step says to ask the user: in a main session, ask. When running as the
node-specialist subagent, state the assumption and return the question. This is a review:
report findings; do not edit unless the request also asks for fixes.

## Steps

1. Read the code in context (the callers and the modules it uses), the Node version from
   `engines` or `.nvmrc`, and the module system (`"type": "module"` or CommonJS). Do not suggest
   features the project's Node version lacks.
2. Promises and async:
   - floating promises (a promise created and not awaited or handled)
   - `await` missing inside `try/catch`, so errors escape the handler
   - `async` callbacks passed to `forEach` (use `for...of` or `Promise.all`)
   - `Promise.all` when one failure should not cancel the rest (consider `allSettled`)
   - unhandled rejections and unhandled `error` events on `EventEmitter`s and streams
   - mixing callbacks and promises in a way that can call back twice
3. Errors: errors thrown as strings or plain objects, swallowed errors (`catch {}` with no
   handling), lost causes when rethrowing (use `new Error(msg, { cause })`), and
   `uncaughtException` handlers that keep the process running in an unknown state. The safe
   pattern is to log and exit so a supervisor restarts it.
4. Streams: use `stream.pipeline` (or `pipeline` from `stream/promises`) rather than manual
   `.pipe()` chains so errors close all streams and backpressure is respected. Look for whole
   files read into memory where a stream would do, and for missing error handlers.
5. Lifecycle: `SIGTERM` and `SIGINT` handled; servers closed and in-flight work finished within
   a deadline; database pools and queues closed; timers and intervals cleared or `unref`'d;
   nothing keeps the process alive by accident.
6. Child processes and the file system: `exec` or `spawn` with `shell: true` built from
   untrusted input is command injection; use `execFile` or `spawn` with an argument array. File
   paths built from user input need normalization and a check that the result stays inside the
   intended directory. Use `fs/promises` rather than sync calls in request paths.
7. Input and data safety: validation at the boundary; unsafe object merges and `__proto__`
   handling (prototype pollution); regular expressions that can backtrack catastrophically
   (ReDoS); `eval` and `new Function`; secrets or tokens in logs; timing-unsafe comparison of
   secrets (use `crypto.timingSafeEqual`); weak password hashing (use argon2 or bcrypt, not a
   plain hash).
8. Package and runtime configuration: `engines` and a lockfile present; scripts that start the
   app directly with `node` so signals reach it (a wrapper that does not forward signals
   prevents graceful shutdown); correct `type` and import style; dependencies listed in the
   right section; `npm audit` high and critical findings.
9. Rank findings blocker (crash, data loss, security hole), major (wrong behavior under load or
   failure), minor. For each give the file and line, what goes wrong and when, and a minimal
   fix. Do not report style preferences. State what you checked and what you did not, and say so
   plainly if you found nothing.
