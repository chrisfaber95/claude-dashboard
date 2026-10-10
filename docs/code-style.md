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
    skins/               skin.ts, _copilot.scss, _root.scss, root-scene.ts, root/ (svg)
    shared/              dom helpers, formatting, api client, esc()
    style.scss, *.html, fonts/
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

## What a cleanup may not change

API routes, JSON field names in `src/shared/types`, `public/` output file names, storage file formats, and every rule
in `CLAUDE.md` (request checks, `claude-cli.ts` as the only command runner, `esc()`). Cleanups preserve behaviour.
Moves use `git mv` in their own PR with only import edits, so `git log --follow` keeps working.

## What ESLint checks

`npm run lint` (`eslint.config.js`, run in CI) enforces, as errors: `id-length` (min 2, except `i`, `j`, `a`, `b`,
`_`), `id-denylist` (`fmt`, `st`, `rec`, `sid`, `msg`, `buf`, `el`, `cls`, `tmp`, `cfg`), `naming-convention`
(camelCase, PascalCase types, UPPER_CASE constants, booleans prefixed `is`/`has`/`should`/`can`),
`no-nested-ternary`, `max-lines` 300, `max-lines-per-function` 50 (not in `tests/`) and `max-depth` 4.

Files in `LEGACY_FILES` are exempt until their cleanup ticket. The list may only shrink; a new or moved file must
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
