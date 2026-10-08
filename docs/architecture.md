# Claude Dashboard: architecture and reference

Reference sections moved out of `CLAUDE.md` (which links here) so they load only when needed.

## Layout

- `src/server/`: Node 24 runs these `.ts` files directly (native type stripping, no compile step, no runtime dependencies)
  - `config.ts`: paths, ports, env overrides, small helpers
  - `transcripts.ts`: incremental JSONL scanner (16 MB chunks) and all in-memory aggregates (tokens, messages, rate-limit hits, session → transcript index, subagent index); `buildSubagents()` filters live subagents; `subagentPaths` maps agent id to transcript path
  - `limits.ts`: live usage API poll with fallback to the `.claude.json` cache
  - `state.ts`: builds the `DashboardState` (live sessions, projects, subagents of live sessions, git info, CLI trust, feature flags)
  - `server.ts`: HTTP(S) server: Host/Origin/CSRF checks, login, `/api/state`, `/api/events` (SSE every 2s), transcript and subagent transcript endpoints, command endpoints, static files from `public/`
  - `auth.ts`: login token file, timing-safe login, per-IP rate limit, in-memory cookie sessions
  - `tls.ts`: self-signed cert for LAN mode via Git's `openssl`
  - `claude-cli.ts`: the **only** place that runs `claude.exe` (`--bg`, `--bg --resume`, `stop`, `logs`), plus the audit log
  - `transcript-view.ts`: turns a transcript into readable entries for the viewer (last 32 MB of a file at most; `sidechain` flag for subagent transcripts)
- `src/client/`: vanilla TypeScript and SCSS, no framework, charts drawn as inline SVG
  - `app.ts`: renders the sections (projects, sessions, usage, limits, messages); shows subagent counts on project cards; skin picker in header (localStorage `skin`, applies `data-skin` attribute to `<html>`, hides Theme button in dark-only skins)
  - `boot.ts`: head script that applies the saved skin and theme before first paint (runs before any other JS to avoid flashing Classic when Root is chosen)
  - `building.ts`: renders the project building popup; rooms for each live session (worker animation by status: busy/waiting/idle, hard hat for background), annex below with cubicles for subagents (one per room, up to 24 per session); pipes show who handed work down (main → bus/stub; subagent → dashed pipe from parent); animations: envelope while working, tick when handed back; click room or cubicle to read transcript; uses `moodOf` from `mood.ts` for status
  - `controls.ts`: the run panel and the transcript drawer (read-write for main sessions, read-only for subagents with `kind: 'subagent'`)
  - `core.ts`: live status strip; markup built once, updated by mood changes; `data-mood` set on `<html>` on status change, read by skin CSS
  - `mood.ts`: pure session/subagent mood logic (`moodOf`, `coreSummary`, `coreHeadlineParts` returns `{ lead, accent }`, `coreHeadline` returns `lead + accent`), shared with `building.ts` and `core.ts`, testable with `node --test`
  - `root-scene.ts`: builds the Root skin hero scene once, lazily, and fills the central seed; only loaded when Root is active
  - `skin.ts`: `Skin` type and the `parseSkin` allowlist
  - `util.ts`: `esc()` and `api()`
  - `_skin-copilot.scss`: KITT-inspired dark skin (near-black, red accent `#ff3b30`, Space Grotesk/JetBrains Mono fonts); loaded via `meta.load-css`, scoped to `:root[data-skin='copilot']`
  - `_skin-root.scss`: Eywa / Tree of Souls skin (deep blue, glowing willow tree, floating seeds; Cormorant Garamond italic headings, Nunito Sans body); loaded via `meta.load-css`, scoped to `:root[data-skin='root']`, reacts to `data-mood` on `<html>`
  - `fonts/`: self-hosted woff2 files with OFL licences (Space Grotesk, JetBrains Mono, Cormorant Garamond, Nunito Sans); the CSP (`default-src 'self'`) blocks remote fonts, so fonts must be self-hosted
  - `root/`: SVG artwork for the Root skin (tree layers, seeds, moss, limbs, etc.); built and served as `<img>`, never inlined
- `src/shared/types.ts`: API types shared by server and client (SessionInfo, SubagentInfo, MessageInfo, etc.); change both sides together
- `public/`: **build output only**; edit `src/client/` instead
- `scripts/dev.mjs`: dev mode orchestrator (watches for HTML changes, esbuild and sass in watch mode, server with hot restart on source changes); calls `copyAssets()` at startup
- `scripts/svg-guard.mjs`: strict allowlist checker (`checkSvg`): whole-file tokenizer, allowlisted elements and attributes, printable ASCII only, no `&`/`\`, no text/comments/PIs/namespace prefixes, only local `url(#id)` references; used by `copy-assets.mjs` and `tests/root-assets.test.ts`
- `scripts/copy-assets.mjs`: clears `public/fonts` and `public/root`, then copies self-hosted skin assets (`src/client/fonts` → `public/fonts`, `src/client/root` → `public/root`), skipping symlinks and copying only whitelisted file types (`.woff2`, `.txt` for fonts; `.svg` for Root skin; SVGs must pass `checkSvg`); used by `copy-html.mjs` and `dev.mjs`; **fails the build if an SVG fails the check**
- `.dashboard/`: login `token`, TLS `key.pem`/`cert.pem`, `commands.log`. **Holds secrets**: never print, serve or commit it

## Data sources (format of Claude Code's internal files, not a public API)

- `~/.claude/sessions/<pid>.json`: one file per session (`kind`, `status`, `name`, `cwd`). A session counts as live only if its `pid` is still running.
- `~/.claude/projects/<slug>/<sessionId>.jsonl`: transcripts. The slug is the cwd with every non-alphanumeric character replaced by `-`. Subagent transcripts live in `<sessionId>/subagents/agent-<id>.jsonl` (one per Agent tool call) plus `.meta.json` with `agentType`, `description`, `toolUseId` (links to spawner's Agent tool_use id), and request shape. All subagent transcripts are filtered by `isSidechain` and included in `DashboardState.subagents`.
- Token usage comes from `message.usage` on assistant lines, deduplicated by `message.id` + `requestId`. `<synthetic>` models are skipped.
- Incoming messages have `origin.kind === "peer"`. Subagent hand-backs appear both ways: (1) tool_result with `status === "completed"` when the spawner reads the Agent tool result; (2) peer origin with `senderTaskId` on user lines (body starts with `[Subagent hand-back]`, older form). Outgoing messages are `SendMessage` tool_use blocks. Subagent hand-backs both confirmed.
- Session-to-session messages (confirmed 2026-10-08, Claude Code 2.1.295, from a headless `claude -p -n probe-T-003` run messaging a named session):
  - Incoming: an `attachment` line with `attachment.type === "queued_command"`, `attachment.prompt` = `<cross-session-message from="…" from-name="…" from-mode="…">body</cross-session-message>`, and `attachment.origin = { kind: "peer", from, msg_id, name, fromMode, body }`. `name` is the sender's session name; `from` is its local pipe address (`uds:\\.\pipe\LOCAL\cc-msg-<hex>`), useless for display. There is no `senderTaskId`, which is what tells it apart from a subagent hand-back. A `queue-operation` line with the same text is also written; it is ignored.
  - Outgoing: `SendMessage` tool_use with `input = { to, message, summary?, type: "message", recipient, recipient_kind: "name", content }`. `to` is the target name, optionally with a ListAgents ref (`"worker [3fa9c1]"`), which is stripped. A failed send (`toolUseResult.success === false`, e.g. "No agent named 'lead' is reachable") still has the tool_use and is still listed.
- Rate-limit hits are lines with `quotaLimits.status === "rejected"`.
- `~/.claude.json` → `cachedUsageUtilization` is the fallback for limits; `projects[...].hasTrustDialogAccepted` is the CLI trust flag per folder.

## Environment variables

- `DASHBOARD_PORT` (4777), `DASHBOARD_HOST` (`127.0.0.1`; anything else means LAN mode)
- `DASHBOARD_COMMANDS` (`0` removes all command endpoints)
- `DASHBOARD_LIVE_USAGE` (polling on by default; `0` turns it off)
- `DASHBOARD_DATA_DIR` (`./.dashboard`)
- `PROJECTS_ROOT` (`N:\Projects`), `CLAUDE_DIR` (`$CLAUDE_CONFIG_DIR`, else `~/.claude`), `CLAUDE_JSON` (`$CLAUDE_CONFIG_DIR/.claude.json`, else `~/.claude.json`); Claude Code relocates both when `CLAUDE_CONFIG_DIR` is set, as on this PC (`N:\ClaudeData\config`)
- `CLAUDE_BIN` (default: the CLI found in this order: `claude.exe` in a `PATH` folder, then the newest `claude.exe` in `~/.vscode/extensions/anthropic.claude-code-*/resources/native-binary/`), `CLAUDE_BIN_ARGS` (JSON array prefix, used by tests), `OPENSSL`

## Claude CLI behaviour (verified)

- Binary lookup order: `CLAUDE_BIN` (+ `CLAUDE_BIN_ARGS`); `claude.exe` (`claude` off Windows) in an absolute `PATH` folder (on Windows only drive-letter paths, no drive-less or UNC entries), native binaries only since `execFile` can't run `.cmd` shims; newest `claude.exe` in the VS Code extension. None found: "Claude CLI not found (set CLAUDE_BIN)". On this PC: `C:\Users\Chris\.local\bin\claude.exe` (2.1.295, found via `PATH`).
- The CLI refuses folders it doesn't trust ("Workspace not trusted"). Trust is only granted by running `claude` interactively in that folder once. The dashboard shows trust status and passes the refusal through as `needsTrust`. Never edit `.claude.json` to grant trust.
- `claude agents --json` lists the same live sessions as `~/.claude/sessions/*.json`.
- **Unverified until a folder is trusted:**
  - the exact `--bg` output and id format (`toResult()` parses a UUID or a lone id line);
  - how a background session behaves when it hits a permission prompt.

## Tests

- `tests/helpers.ts` → `makeFixture()` builds a fake `~/.claude`, projects tree and data dir in a temp dir and sets the env vars above. Server modules read env when they load, so call `makeFixture()` **before** a dynamic `await import(...)` of the module under test.
- `node --test` runs each file in its own process, so module-level state doesn't leak between files.
- Inside one file, `resetTranscripts()` also forgets file offsets, so the next scan re-reads every fixture written so far. Filter assertions by `sessionId`.
- Mock `globalThis.fetch` in tests; tests must never touch the network or real user files.
- Command tests use `tests/fake-claude.mjs` via `CLAUDE_BIN=node` + `CLAUDE_BIN_ARGS`. It records argv and cwd to `FAKE_CLAUDE_LOG`. Assert exact argument arrays.
- Use `raw()` from `helpers.ts` for HTTP tests that must set `Host`, `Origin` or cookies exactly (`fetch` normalises these).
- Test files: `tests/mood.test.ts` (session/subagent mood logic), `tests/skin.test.ts` (skin parsing), `tests/static-fonts.test.ts` (font file validation), `tests/root-assets.test.ts` (Root skin SVG guard), `tests/copy-assets.test.ts` (asset copying), `tests/claude-bin.test.ts` (Claude CLI lookup order).

## UI conventions

- Colors use the validated palette from the `dataviz` skill, defined once in `style.scss` with light and dark versions. Dark mode follows the OS and can be overridden with `data-theme` on `<html>`.
- **Skins:** CSS themes swap tokens (`--font-ui`, `--font-mono`, `--accent`, `--radius-panel`, etc.) and must keep the validated chart series `--s1..--s8` (for accessibility). Classic (light/dark, OS-following, system fonts); Co-pilot (dark only, KITT-inspired); Root (deep blue, glowing tree, Cormorant Garamond italic + Nunito Sans). New skins: add `_skin-<name>.scss` with one `meta.load-css` line, extend `Skin`/`SKINS` types, add an `<option>` to the selector. Skin artwork is static same-origin SVG under `src/client/<name>/`, served as `<img>`, never inlined via innerHTML; any SVG must pass `checkSvg` (whole-file tokenizer, allowlisted elements/attributes, printable ASCII only, no external refs, local `url(#id)` only). The build enforces this: `copy-assets.mjs` fails if an SVG fails the check.
- Heavy scene DOM is built lazily only for its skin (e.g., `ensureRootScene()` in `root-scene.ts` only when Root is active), so other skins never load unused artwork.
- Fonts must be self-hosted under `/fonts/` (files + OFL licence .txt); the CSP (`default-src 'self'`) blocks Google Fonts. Never relax the CSP for fonts.
- Sections re-rendered by SSE pushes restart CSS animations: build animated elements once and patch them (toggle class, set text), or replace their HTML only when it changed.
- Animations always run: don't add `prefers-reduced-motion` rules (the user chose this; Windows "Animation effects" is off on this PC, which made browsers freeze every animation).
- Animate only transform and opacity; filters only on static layers (the dashboard runs all day).
- Project colors are assigned by project name in alphabetical order, never by rank. A filter must not recolor the projects that stay visible.
- **No inline styles in new client code:** sizes, colours, animation delays are defined as CSS classes in `style.scss` (e.g. `.tint-N`, `.shirt-N`, `.skin-N`, `.building__svg--cols-N`). Existing inline styles (chart bars, legend swatch in `app.ts`) pre-date this rule and are not changed.
- Escape every interpolated string with `esc()` (`util.ts`), since rendering uses `innerHTML`.
- Forms (run panel, follow-up box) are never re-rendered by state pushes, so typing isn't interrupted; `updateControls()` only patches options.
