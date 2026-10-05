# Claude Dashboard

Web dashboard for Claude Code activity: the projects in `N:\Projects`, live sessions and their transcripts, messages between sessions, token usage and subscription limits. It reads Claude Code's files under `~/.claude` and polls the Anthropic usage API. It can also start, follow up on and stop background Claude sessions through the Claude CLI, and can be exposed on the LAN behind a login.

**Treat it as a remote-execution surface:** anyone past the login can make Claude act on this PC.

## Commands

- `npm start`: build the client, then serve on http://127.0.0.1:4777 (no login)
- `npm run start:lan`: same, but on all interfaces over HTTPS with a token login (`--lan` flag)
- `npm test`: `node:test` suites in `tests/`
- `npm run typecheck`: `tsc --noEmit` over `src` and `tests`
- `npm run build`: esbuild `src/client/app.ts` + `login.ts` → `public/`, sass `style.scss` → `public/style.css`, copy `index.html` + `login.html`

Run `npm run typecheck` and `npm test` after every change.

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
  - `app.ts`: renders the sections (projects, sessions, usage, limits, messages); shows subagent counts on project cards
  - `building.ts`: renders the project building popup; rooms for each live session (worker animation by status: busy/waiting/idle, hard hat for background), annex below with cubicles for subagents (one per room, up to 24 per session); pipes show who handed work down (main → bus/stub; subagent → dashed pipe from parent); animations: envelope while working, tick when handed back; click room or cubicle to read transcript
  - `controls.ts`: the run panel and the transcript drawer (read-write for main sessions, read-only for subagents with `kind: 'subagent'`)
  - `util.ts`: `esc()` and `api()`
- `src/shared/types.ts`: API types shared by server and client (SessionInfo, SubagentInfo, MessageInfo, etc.); change both sides together
- `public/`: **build output only**; edit `src/client/` instead
- `.dashboard/`: login `token`, TLS `key.pem`/`cert.pem`, `commands.log`. **Holds secrets**: never print, serve or commit it

## TypeScript constraints

- `erasableSyntaxOnly` is on: no `enum`, `namespace` or constructor parameter properties (Node can't strip them).
- Relative imports must include the `.ts` extension (`./config.ts`).
- Type-only imports use `import type` (`verbatimModuleSyntax`).

## Data sources (format of Claude Code's internal files, not a public API)

- `~/.claude/sessions/<pid>.json`: one file per session (`kind`, `status`, `name`, `cwd`). A session counts as live only if its `pid` is still running.
- `~/.claude/projects/<slug>/<sessionId>.jsonl`: transcripts. The slug is the cwd with every non-alphanumeric character replaced by `-`. Subagent transcripts live in `<sessionId>/subagents/agent-<id>.jsonl` (one per Agent tool call) plus `.meta.json` with `agentType`, `description`, `toolUseId` (links to spawner's Agent tool_use id), and request shape. All subagent transcripts are filtered by `isSidechain` and included in `DashboardState.subagents`.
- Token usage comes from `message.usage` on assistant lines, deduplicated by `message.id` + `requestId`. `<synthetic>` models are skipped.
- Incoming messages have `origin.kind === "peer"`. Subagent hand-backs appear both ways: (1) tool_result with `status === "completed"` when the spawner reads the Agent tool result; (2) peer origin with `senderTaskId` on user lines (body starts with `[Subagent hand-back]`, older form). Outgoing messages are `SendMessage` tool_use blocks. Session-to-session format is **unconfirmed**; subagent hand-backs both confirmed.
- Rate-limit hits are lines with `quotaLimits.status === "rejected"`.
- `~/.claude.json` → `cachedUsageUtilization` is the fallback for limits; `projects[...].hasTrustDialogAccepted` is the CLI trust flag per folder.

## Rules

- **Never write to `~/.claude` or `~/.claude.json`.** The dashboard only reads them.
- **The OAuth token** (`~/.claude/.credentials.json` → `claudeAiOauth.accessToken`) is read only inside `pollLive()`, per request:
  - Never log it, return it from the API, or put it in an error message.
  - Never refresh it: refreshing rotates the token and can log Claude Code out.
  - Don't open or print the credentials file during development either.
- **Network:** localhost mode has no login, so it must answer only loopback `Host` headers (DNS-rebinding guard). LAN mode (`--lan` or `DASHBOARD_HOST`) always uses HTTPS + login. Never add a way to bind beyond loopback without auth.
- **Request checks in `server.ts` stay intact:**
  - the Host guard;
  - rejecting `Sec-Fetch-Site: cross-site` on `/api/*`;
  - a same-origin `Origin` on every POST, and `X-Dashboard: 1` on API POSTs;
  - the path-traversal guard and the security headers.

  `Referrer-Policy` must stay `same-origin`: `no-referrer` makes browsers send `Origin: null` on form POSTs and breaks login.
- **Commands:**
  - Only through `claude-cli.ts`, with `execFile` and an argument array. Never `shell: true`, never string-built command lines.
  - Prompts starting with `-` get a prefix so they can't be parsed as CLI flags.
  - Projects must be a folder directly under `PROJECTS_ROOT`. Follow-ups need the session's cwd to be inside one.
  - Permission modes are allowlisted (`plan`, `default`, `acceptEdits`, `auto`). Never allow `bypassPermissions` or `dontAsk`.
  - Every command is audited to `.dashboard/commands.log`. At most 4 CLI processes run at once.
- **Client XSS:**
  - Every interpolated value goes through `esc()`.
  - Tooltips (`data-tip`) are rendered with `textContent`, because attribute values come back entity-decoded. Never switch them to `innerHTML`.
  - The CSP allows no inline scripts; keep scripts in bundled files.
- Error messages that reach the browser are fixed strings, never raw exception text (JSON parse errors can quote secrets).
- Session JSON and `.claude.json` can be caught mid-write: catch parse errors and retry on the next tick, never crash.
- Usage is shown in **tokens only**, with no cost estimates (the user chose this).

## Environment variables

- `DASHBOARD_PORT` (4777), `DASHBOARD_HOST` (`127.0.0.1`; anything else means LAN mode)
- `DASHBOARD_COMMANDS` (`0` removes all command endpoints)
- `DASHBOARD_LIVE_USAGE` (polling on by default; `0` turns it off)
- `DASHBOARD_DATA_DIR` (`./.dashboard`)
- `PROJECTS_ROOT` (`N:\Projects`), `CLAUDE_DIR` (`$CLAUDE_CONFIG_DIR`, else `~/.claude`), `CLAUDE_JSON` (`$CLAUDE_CONFIG_DIR/.claude.json`, else `~/.claude.json`); Claude Code relocates both when `CLAUDE_CONFIG_DIR` is set, as on this PC (`N:\ClaudeData\config`)
- `CLAUDE_BIN` (default: newest `claude.exe` in the VS Code extension), `CLAUDE_BIN_ARGS` (JSON array prefix, used by tests), `OPENSSL`

## Claude CLI behaviour (verified)

- `claude` is not on PATH; the binary ships with the VS Code extension.
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

## Project agents (`.claude/agents/`)

The folder contains 13 agents, originally from VoltAgent (agent-installer, debugger, frontend-developer, security-auditor) and chris-marketplace (the rest). Use them when the task matches:

- `typescript-pro`, `node-specialist`: server and type work
- `frontend-developer`: client UI in `src/client/`
- `test-automator`: new or changed `node:test` suites
- `frontend-tester`: Playwright browser end-to-end tests (from chris-marketplace `playwright`; uses the `playwright` MCP server in `.mcp.json`)
- `code-reviewer`: review before finishing larger changes
- `security-auditor` (read-only): run it after any change to auth, request checks, `claude-cli.ts`, `limits.ts`, the static file handler or client rendering
- `debugger`: parser or aggregation results that don't match the raw transcripts
- `agent-installer`, `architect-reviewer`, `dependency-manager`, `documentation-engineer`, `git-workflow-manager`: used when their task matches

Also see `.claude/skills/` for 24 reusable skills.

## UI conventions

- Colors use the validated palette from the `dataviz` skill, defined once in `style.scss` with light and dark versions. Dark mode follows the OS and can be overridden with `data-theme` on `<html>`.
- Project colors are assigned by project name in alphabetical order, never by rank. A filter must not recolor the projects that stay visible.
- **No inline styles in new client code:** sizes, colours, animation delays are defined as CSS classes in `style.scss` (e.g. `.tint-N`, `.shirt-N`, `.skin-N`, `.building__svg--cols-N`). Existing inline styles (chart bars, legend swatch in `app.ts`) pre-date this rule and are not changed.
- Escape every interpolated string with `esc()` (`util.ts`), since rendering uses `innerHTML`.
- Forms (run panel, follow-up box) are never re-rendered by state pushes, so typing isn't interrupted; `updateControls()` only patches options.

<!-- project-setup:start -->
## Toolkit agents

Project parameters for the agents: @.claude/project-params.md

## Git

Delegate every git and GitHub operation (commit, push, branch, PR, CI check, merge, branch
cleanup, release, merge/rebase conflicts, git setup) to the `git-workflow-manager` agent in
`.claude/agents/`. Do not run these yourself. Project-specific git rules live in the `git` section
of `.claude/project-params.md`; the agent reads it.

Commit, push, PR and merge are pre-authorized for git work: do not ask the user before
delegating them. When a piece of work is finished, delegate "commit, push, open the PR and merge
it"; the agent merges only once CI and every merge gate pass. If the `git` section of
`.claude/project-params.md` sets `merge_mode: ask`, PRs are still opened without asking, but ask
the user before delegating a merge.

In every delegation prompt, include:
- any restriction on those defaults ("commit only", "no push", "don't merge") and any extra
  action the user authorized: "cleanup", "release", "continue the rebase" (anything else is
  returned as a proposal)
- the Co-Authored-By trailer and PR attribution line for this session, if any
- for a PR: why the change exists, architecture decisions, exactly which tests and checks were
  run, how it was manually validated, known limitations, and the revision id and name if one is
  used. The agent writes "Not provided" for anything missing and never invents test results.

If the agent returns "Needs approval" (a failed gate, red or pending CI, possible secrets, an
action outside the defaults), show the drafts to the user. Once the user approves, delegate again
with that action authorized.

Final report after each piece of work (you write it, the agent only supplies the git facts):
what was implemented and why, tests run, CI status, PR number, merge status, limitations and
follow-ups. Keep it concise, then ask the user whether the implementation is correct and whether
to move on to the next planned item.

## Node.js runtime

Delegate Node-specific problems (slow or memory-hungry processes, blocked event loop, async and
error-handling bugs, stream and shutdown problems, Node security review) to the
`node-specialist` agent in `.claude/agents/` when the task clearly matches. In the delegation
prompt, include:
- the symptom or area to review, and how to reproduce it
- the Node version and framework if known
- whether running and load testing the server locally is allowed

The agent measures before and after and reports only numbers it took. It works on its own and
never touches production; if it lists follow-ups, you decide who does them.

## TypeScript

Delegate type-system work (designing types, fixing type errors, typing API and config
boundaries, migrating JavaScript to TypeScript step by step) to the `typescript-pro` agent in
`.claude/agents/`, in projects that use or are adopting TypeScript. In the delegation
prompt, include:
- the files or area, and the current `tsconfig` strictness
- whether runtime behavior must stay unchanged (it normally must)

If the project is plain JavaScript and you did not ask for a migration, the agent does not
convert anything. It works on its own; follow-ups it lists are for you to route.

## Automated testing

Delegate unit, integration and API tests (writing them, reproducing a bug with a failing test,
fixing flaky tests, finding coverage gaps) to the `test-automator` agent in `.claude/agents/`. In the delegation prompt, include:
- what to test, or the change to cover
- the package folder, and how tests are run if it is not obvious

The agent uses the project's own test runner, never uses live databases, payment providers or
mail servers, and reports the real results of the commands it ran (it does not count a
placeholder `npm test` as a pass). Browser end-to-end tests are outside its scope. It works on
its own; follow-ups it lists are for you to route.

## Dependencies

Delegate dependency audits and upgrades to the `dependency-manager` agent in `.claude/agents/`. In the delegation prompt, include:
- the package folder to work in (for repos with several independent packages)
- whether it should only audit, or also upgrade (it upgrades only when asked)
- any dependency policy (packages that must not change, how install scripts are handled)

An audit is read-only. An upgrade changes one package or group at a time and runs the tests, lint
and build after each step. The agent never forces installs, never edits lockfiles by hand, never
approves install scripts it has not read, and never commits. It works on its own; follow-ups it
lists are for you to route.

## Code review

Before committing or merging, delegate a review of the change to the `code-reviewer` agent in
`.claude/agents/`. In the delegation prompt, include:
- what to review: the working-tree diff, a branch against its base, a PR number, or named files
- what the change is meant to do
- whether it should also do a security-focused pass (it does for anything touching auth, input,
  data access, secrets, files or payments)

The agent is read-only: it reports findings ranked by severity with file and line, and never
edits code. You (or another agent you choose) make the fixes. It works on its own; if it lists
follow-ups needing a specialist, you decide who handles them.

## Documentation

Delegate documentation work (README, guides, API reference, architecture overview, and updating
docs after a change) to the `documentation-engineer` agent in `.claude/agents/`. In the
delegation prompt, include:
- what to document, or what changed (a diff or branch)
- the audience, and where the project keeps its docs
- any per-change documents the project requires (the agent follows the rules in `CLAUDE.md` and
  `.claude/project-params.md`)

The agent changes documentation files only, verifies commands and examples by running them when
that is safe and local, and reports mismatches between code and docs instead of changing code. It
works on its own; follow-ups it lists are for you to route.

## Architecture review

Delegate design reviews (boundaries, coupling, data ownership, scalability, failure modes,
technology choices) and architecture decision records to the `architect-reviewer` agent in
`.claude/agents/`, when the task clearly matches. In the delegation prompt, include:
- what to review (files, a diff, or a description of the proposed design)
- the goals, constraints and any numbers the design must meet
- whether you want a decision record written (otherwise it only reports)

The agent is read-only for source code and reports findings with evidence and options. It works
on its own; if it lists follow-ups, you decide who does them.

## Frontend Testing

Delegate all frontend testing work (setting up Playwright, writing or reviewing tests, running
tests, debugging failures) to the `frontend-tester` agent in `.claude/agents/`. In the
delegation prompt, include:
- what to test: the URL or feature, user flow, or test scenarios
- whether running tests is authorized and on which environment (local is default; for staging,
  name it by full URL)

The agent uses the Playwright MCP server (`playwright` in `.mcp.json`) for browser exploration
and to generate stable selectors. It may install `@playwright/test` as a dev dependency, download
browsers, and start the local dev server. It does not commit; it reports the test files and any
`package.json` changes in its result. It works on its own; follow-ups it lists are for you to
route.

Handoffs: the agent's result may end with Handoffs entries (`to`, `why`, `task`, `context`,
`needs authorization`). Route an entry to the named agent only if that agent is installed (it is
in your list of available agents); otherwise do the work yourself or show it to the user. Never
grant authorization the user has not given; ask first.
<!-- project-setup:end -->
