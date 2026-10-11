# Code style

How code in this repo is organised and named. Source: team-hq decision 0006. It applies to **all new and
changed code**; do not rewrite untouched old code outside a cleanup ticket. `tests/code-structure.test.ts` enforces
the folder map and the size cap.

## Folder map

Code is grouped by feature. `tests/` mirrors `src/` (`tests/server/auth/auth.test.ts`); `tests/helpers/` holds
fixtures and the fake CLI.

```
src/
  client/
    app/                 boot.ts, app.ts (shell: wires features together), patch.ts
    features/<feature>/  <feature>.view.ts (DOM), <feature>.logic.ts (pure), _<feature>.scss
    skins/               skin.ts, _copilot.scss, _root.scss, root-scene.ts, root/ (svg), fonts/
    shared/              dom helpers, formatting, api client, esc()
    style.scss, *.html
  server/
    main.ts or server.ts (entry), config.ts
    http/                request guards, static files, routes per feature
    auth/                auth, devices, tls
    claude/              claude-cli (still the only place that runs claude.exe), session-summary
    transcripts/         scanner/aggregates, state, transcript-view
    features/            alerts, audit-log, team, limits, settings, launch, permissions, ...
  shared/types/          one file per domain + index.ts
```

A `.ts` file under `src/client` or `src/server` lives in one of these folders. The only loose server files are the
entry points `main.ts`, `server.ts` and `config.ts`. Add a new feature folder when a feature does not fit an
existing one.

## Names

- Full words. Allowed abbreviations: `id`, `url`, `html`, `css`, `api`, `json`, `cli`, `tls`, `sse`, `dom`, and unit
  suffixes (`Ms`, `Bytes`, `Px`).
- Single letters only for a loop index (`i`, `j`) or a one-line comparator `(a, b) =>`.
- Booleans read as a question (`isLive`, `hasToken`, `shouldRetry`). Functions start with a verb. Collections are
  plural. Units are in the name (`timeoutMs`).
- Files are kebab-case and named after what they hold. No `util.ts` grab bags.

## Size and shape

- One responsibility per module. Split a file over ~300 lines or a function over ~50 lines.
- No nested ternaries; early returns over deep nesting; magic numbers become named constants.
- Keep pure logic apart from DOM and I/O (`<feature>.logic.ts`), so `node:test` can cover it.

## Comments

- Exported functions and types get a one-line doc comment.
- Other comments explain *why*, never what.

## Vue single-file components (decision 0007)

- A `.vue` file sits next to its `<feature>.logic.ts` in the feature folder. `<script setup lang="ts">`, Composition
  API only (no Options API, no Pinia).
- Markup is normal indented HTML. `<template src="./<name>.html">` is allowed, but `vue-tsc` does **not**
  type-check external templates (T-050 probed it), so a template that binds more than trivial values stays inline
  until the lead decides otherwise.
- No `v-html`, ever (`vue/no-v-html` is an error): Vue escapes text and attributes, which replaces `esc()`.
- Typing: no `any`, no `as` (except `as const`), no non-null `!` in new or changed code. Values from outside the
  program (JSON, network, `~/.claude`, `dataset`, `event.target`) arrive as `unknown` and are narrowed by a type
  guard; DOM elements by `instanceof`; constant data uses `satisfies`. Exported functions declare their return type.
- Component tests use Vitest + `@vue/test-utils` (`*.component.spec.ts` under `tests/client/`).

## What a cleanup may not change

API routes, JSON field names in `src/shared/types`, `public/` file names that the server serves before login (`login.js`, `pair.js`, `style.css`), storage file formats, and every rule
in `CLAUDE.md` (request checks, `claude-cli.ts` as the only command runner, `esc()`). Cleanups preserve behaviour.
Moves use `git mv` in their own PR with only import edits, so `git log --follow` keeps working.

## What ESLint checks

`npm run lint` (`eslint.config.js`, run in CI) enforces, as errors: `id-length` (min 2, except `i`, `j`, `a`, `b`,
`_`), `id-denylist` (`fmt`, `st`, `rec`, `sid`, `msg`, `buf`, `el`, `cls`, `tmp`, `cfg`), `naming-convention`
(camelCase, PascalCase types, UPPER_CASE constants, booleans prefixed `is`/`has`/`should`/`can`),
`no-nested-ternary`, `max-lines` 300, `max-lines-per-function` 50 (not in `tests/`) and `max-depth` 4, in `.ts` and `.vue` files (the latter through `eslint-plugin-vue`'s essential rules and `vue/no-v-html`).

The typing rules above are errors too (`@typescript-eslint/no-explicit-any`, `no-non-null-assertion`,
`consistent-type-assertions` with `assertionStyle: 'never'` so only `as const` passes, and
`explicit-module-boundary-types`), in `.ts` and `.vue` files. `TYPE_SAFETY_LEGACY_FILES` in `eslint.config.js` lists the
files that still break them; like `LEGACY_FILES` it may only shrink (`tests/lint-config.test.ts` checks that every entry
exists). Never add a file to it; fixing a file means removing its entry in the same change.

`LEGACY_FILES` in `eslint.config.js` is empty: every file passes. Never add a file to it; a new or moved file must
pass. Left to review: other abbreviations, verb-first function names, plural collections, units in names, one
responsibility per module, magic numbers, comments, and the folder map (`tests/code-structure.test.ts`).

## Examples

Names and nested ternary (`fmt` in `src/client/app/app.ts`):

```ts
// Before
const fmt = (n: number) =>
  n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);

// After
const BILLION = 1e9;
const MILLION = 1e6;
const THOUSAND = 1e3;

/** Format a token count as 1.2k, 3.40M or 1.50B. */
function formatTokenCount(tokenCount: number): string {
  if (tokenCount >= BILLION) return `${(tokenCount / BILLION).toFixed(2)}B`;
  if (tokenCount >= MILLION) return `${(tokenCount / MILLION).toFixed(2)}M`;
  if (tokenCount >= THOUSAND) return `${(tokenCount / THOUSAND).toFixed(1)}k`;
  return String(tokenCount);
}
```

Single-letter parameter (`total` in `src/client/app/app.ts`):

```ts
// Before
const total = (t: TokenCounts) => t.input + t.output + t.cacheRead + t.cacheWrite;

// After
/** Sum every token kind of one usage record. */
const sumTokens = (tokens: TokenCounts) => tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
```

Folder: `src/client/alerts.ts` and `alerts-logic.ts` become `src/client/features/alerts/alerts.view.ts` and
`alerts.logic.ts`, with `tests/client/features/alerts/alerts.logic.test.ts` beside the mirror.

## Component tests

Two runners, each with its own file suffix, so neither picks up the other's files:

- `*.test.ts`: `node:test` (`npm run test:node`), for logic, server and source-scan tests.
- `*.component.spec.ts`: Vitest with `@vue/test-utils` and `happy-dom` (`npm run test:component`, config in
  `vitest.config.ts`), for Vue components. They live in `tests/client/features/<feature>/` beside the mirror, e.g.
  `tests/client/features/core/click-counter.component.spec.ts`.

`npm test` runs both. Import `describe`, `it` and `expect` from `vitest` explicitly (no globals).
