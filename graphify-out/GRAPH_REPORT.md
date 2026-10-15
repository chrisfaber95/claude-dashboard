# Graph Report - Claude-dashboard  (2026-10-10)

## Corpus Check
- 252 files · ~138,929 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 10 file(s) not represented in the graph (top: .woff2 5, .scss 4, (none) 1)

## Summary
- 1586 nodes · 4271 edges · 86 communities (81 shown, 5 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 130 edges (avg confidence: 0.87)
- Token cost: 364,438 input · 0 output

## Community Hubs (Navigation)
- Building Annex View
- Audit and Permissions UI
- DOM Patching
- Node Built-in Imports
- Session Controls Drawer
- HTTP Guards and TLS
- LAN Audit Stream Tests
- Command Follow-up Tests
- Server Config
- Command Routes and Validation
- Subagent Index
- Usage Charts
- Limits Gauges
- Session Summaries
- Auth Core
- Permission Requests Server
- Alerts Engine
- Chat Logic
- Device QR Pairing UI
- Subagent Feed Tests
- Popups
- Device Store
- Audit Log Store
- Session Summary Tests
- Shared API Types
- Claude CLI Wrapper
- Git Workflow Rules
- Core Mood View
- Test Fixtures and Fake CLI
- App Render Loop
- Transcript Aggregates
- Transcript Indexing
- Build Asset Scripts
- End-to-End Flow Tests
- CI and Agent Delegation
- Playwright Testing Skills
- Request Context and Identity
- Project Parameters
- Claude Data Sources
- Chat View
- Message Graph
- Root Skin Scene
- Server Tests
- Chat State
- TypeScript Config
- VoltAgent Legacy Agents
- Login and Pair Pages
- Appearance and Skins
- Alert Toasts
- Auth Interface
- Dependency Policy
- Code and Node Review Skills
- Code Structure Test
- npm Scripts
- Permission Hook Script
- Seed Sprite Art
- Toolkit Agent Protocols
- Security Rules and Secrets
- CPU Measurement Script
- State Stream and Settings UI
- Launch Controls
- Sessions List
- Login Limiter and Pairing
- Limits Polling
- Alerts Tests
- Client XSS and Page Shell
- UI Conventions
- Package Manifest
- Device List Logic
- Auth Tests
- Command Execution Rules
- Dev Dependencies
- Loopback Detection
- Test Coverage Skills
- TypeScript Migration Skills
- Session Store
- Performance Notes
- ESLint Config
- QR Code Logic
- Tree Layer Art
- Permission Hook Route
- Summary Settings
- MCP Config
- Agent Installer

## God Nodes (most connected - your core abstractions)
1. `elementById()` - 88 edges
2. `esc()` - 53 edges
3. `CommandError` - 38 edges
4. `DashboardState` - 36 edges
5. `send()` - 32 edges
6. `raw()` - 30 edges
7. `patchHtml()` - 21 edges
8. `api()` - 21 edges
9. `Auth` - 20 edges
10. `render()` - 19 edges

## Surprising Connections (you probably didn't know these)
- `buildHero()` --references--> `curtain.svg (dark diagonal hanging-vine curtain backdrop)`  [INFERRED]
  src/client/skins/root-scene.ts → src/client/skins/root/curtain.svg
- `buildHero()` --references--> `limbs.svg (dark trunk and limb silhouette, limbFade gradient)`  [INFERRED]
  src/client/skins/root-scene.ts → src/client/skins/root/limbs.svg
- `buildHero()` --references--> `Tree of Souls layer stack (glow + 4 shimmer layers)`  [INFERRED]
  src/client/skins/root-scene.ts → src/client/skins/root/tree-1.svg
- `node-specialist (archived VoltAgent version)` --semantically_similar_to--> `node-specialist`  [INFERRED] [semantically similar]
  .claude/agents-archive/node-specialist.md → .claude/agents/node-specialist.md
- `Login page (login.html)` --conceptually_related_to--> `LAN mode (HTTPS + login, --lan / DASHBOARD_HOST)`  [INFERRED]
  src/client/login.html → CLAUDE.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Toolkit agents sharing Handoffs, project procedures and project-params sections** — claude_agents_architect_reviewer, claude_agents_code_reviewer, claude_agents_dependency_manager, claude_agents_documentation_engineer, claude_agents_frontend_tester, claude_agents_git_workflow_manager, claude_agents_node_specialist, claude_agents_test_automator, claude_agents_typescript_pro, claude_agents_architect_reviewer_handoffs_protocol, claude_agents_architect_reviewer_project_procedures, claude_project_params [EXTRACTED 1.00]
- **VoltAgent-style agents using the context manager query protocol** — claude_agents_archive_code_reviewer, claude_agents_archive_node_specialist, claude_agents_archive_test_automator, claude_agents_archive_typescript_pro, claude_agents_debugger, claude_agents_security_auditor, claude_agents_frontend_developer, claude_agents_archive_code_reviewer_context_manager_protocol [EXTRACTED 1.00]
- **Read-only review and check agents (never edit code)** — claude_agents_code_reviewer, claude_agents_architect_reviewer, claude_agents_security_auditor, claude_agents_test_runner [INFERRED 0.85]
- **Git workflow skills followed by git-workflow-manager (commit, pr, merge, release, resolve-conflicts)** — claude_skills_commit_skill, claude_skills_pr_skill, claude_skills_merge_skill, claude_skills_release_skill, claude_skills_resolve_conflicts_skill, claude_agents_git_workflow_manager [EXTRACTED 1.00]
- **Playwright skills used by frontend-tester (setup, run-tests, write-test, debug-test)** — claude_skills_setup_skill, claude_skills_run_tests_skill, claude_skills_write_test_skill, claude_skills_debug_test_skill, claude_agents_frontend_tester [INFERRED 0.95]
- **Below-browser test skills used by test-automator (write-tests, coverage-gaps, fix-flaky-tests)** — claude_skills_write_tests_skill, claude_skills_coverage_gaps_skill, claude_skills_fix_flaky_tests_skill, claude_agents_test_automator [EXTRACTED 1.00]
- **LAN sign-in and device pairing flow** — src_client_login, src_client_pair, docs_architecture_qr_pairing, docs_architecture_sliding_sessions, docs_architecture_loopback_exemption, src_server_auth_auth [EXTRACTED 1.00]
- **Server security rules for a remote-execution surface** — claude_request_checks, claude_dns_rebinding_guard, claude_referrer_policy_same_origin, claude_command_rules, claude_permission_mode_allowlist, claude_oauth_token_rule, claude_fixed_error_strings [EXTRACTED 1.00]
- **Self-hosted OFL skin fonts** — src_client_fonts_ofl_cormorantgaramond, src_client_fonts_ofl_jetbrainsmono, src_client_fonts_ofl_nunitosans, src_client_fonts_ofl_spacegrotesk, docs_architecture_self_hosted_fonts [EXTRACTED 1.00]
- **Seed sprite composed of 11 strand slices and a body** — src_client_skins_root_seed_1, src_client_skins_root_seed_2, src_client_skins_root_seed_3, src_client_skins_root_seed_4, src_client_skins_root_seed_5, src_client_skins_root_seed_6, src_client_skins_root_seed_7, src_client_skins_root_seed_8, src_client_skins_root_seed_9, src_client_skins_root_seed_10, src_client_skins_root_seed_11, src_client_skins_root_seed_body [INFERRED 0.95]
- **Root hero backdrop: curtain, limbs, glow and tree layers** — src_client_skins_root_curtain, src_client_skins_root_limbs, src_client_skins_root_tree_glow, src_client_skins_root_tree_1, src_client_skins_root_tree_2, src_client_skins_root_tree_3, src_client_skins_root_tree_4 [INFERRED 0.95]

## Communities (86 total, 5 thin omitted)

### Community 0 - "Building Annex View"
Cohesion: 0.08
Nodes (60): annexHtml(), CODE_LINE_WIDTHS, cubicleCodeHtml(), cubicleHtml(), CubiclePosition, cubiclePositions(), mailHtml(), mainSessionPipesHtml() (+52 more)

### Community 1 - "Audit and Permissions UI"
Cohesion: 0.07
Nodes (49): actionLabel(), ACTIONS, ALL_DEVICES, auditQuery(), AuditRow, DeviceOption, mergeDeviceOptions(), pad() (+41 more)

### Community 2 - "DOM Patching"
Cohesion: 0.05
Nodes (37): attrNames(), forgetHtml(), keyOf(), lastHtml, patchAttrs(), patchChildren(), patchIfChanged(), patchNode() (+29 more)

### Community 3 - "Node Built-in Imports"
Cohesion: 0.07
Nodes (30): ref_node_assert, ref_node_fs, ref_node_os, ref_node_path, ref_node_test, ref_node_url, startupLines(), source (+22 more)

### Community 4 - "Session Controls Drawer"
Cohesion: 0.10
Nodes (42): describeCommandResult(), DrawerMode, entrySpeaker(), ResolvedSession, resolveSession(), ROLE_LABEL, showsTranscript(), SUBAGENT_LABEL (+34 more)

### Community 5 - "HTTP Guards and TLS"
Cohesion: 0.11
Nodes (33): ensureCert(), lanAddresses(), createPermissionStore(), checkFetchSite(), checkHost(), checkPostOrigin(), findGuardRejection(), GuardInput (+25 more)

### Community 6 - "LAN Audit Stream Tests"
Cohesion: 0.15
Nodes (32): raw(), answer(), answerFromPc(), lanGet(), auditOf(), AuditRow, auth, clock (+24 more)

### Community 7 - "Command Follow-up Tests"
Cohesion: 0.11
Nodes (31): jsonl(), transcriptDir(), makeLive(), holdRequest(), hookPost(), isPending(), alpha, calls() (+23 more)

### Community 8 - "Server Config"
Cohesion: 0.09
Nodes (33): canRunCommands, CLAUDE_JSON, cwdSlug(), HOST, isLanMode, localDay(), normPath(), PORT (+25 more)

### Community 9 - "Command Routes and Validation"
Cohesion: 0.21
Nodes (27): audit(), CommandError, validateMode(), validatePrompt(), RouteHandler, isInsideProject(), listProjectNames(), readJson() (+19 more)

### Community 10 - "Subagent Index"
Cohesion: 0.12
Nodes (32): agentToolUse, buildSubagents(), HandBack, handedBack, loadMeta(), Spawn, SPAWN_TOOL_NAMES, spawns (+24 more)

### Community 11 - "Usage Charts"
Cohesion: 0.14
Nodes (27): BarSegment, daySegments(), OTHER_SERIES, otherTokensOfDay(), seriesNames(), visibleDayTotal(), barsHtml(), dayTableHtml() (+19 more)

### Community 12 - "Limits Gauges"
Cohesion: 0.15
Nodes (24): clampPercent(), highestUtilization(), limitLevelClass(), limitStatusText(), gaugeHtml(), hitsHtml(), renderLimits(), sourceText() (+16 more)

### Community 13 - "Session Summaries"
Cohesion: 0.10
Nodes (29): cache, CacheEntry, COOLDOWN_NOTE, cut(), EXCERPT_MAX, excerptSession(), inflight, LiveInfo (+21 more)

### Community 14 - "Auth Core"
Cohesion: 0.11
Nodes (22): ref_node_crypto, AuthOptions, createAuth(), createRevocation(), createSessionMethods(), createSignIn(), readCookie(), RevokeMethods (+14 more)

### Community 15 - "Permission Requests Server"
Cohesion: 0.10
Nodes (19): APP_ROOT, AnswerResult, APPROVAL_TEXT_AUDIT_MAX, copyHookScript(), createRequestBook(), finish(), rememberSettled(), createSecretFile() (+11 more)

### Community 16 - "Alerts Engine"
Cohesion: 0.12
Nodes (26): alertThreshold(), buildAlerts(), clock(), DEFAULT_THRESHOLD, deriveAlerts(), dismissAlert(), dismissed, failures (+18 more)

### Community 17 - "Chat Logic"
Cohesion: 0.13
Nodes (25): alertLabel(), answer(), attentionReply(), candidates(), dayKey(), fmtReset(), fmtTokens(), HELP_TEXT (+17 more)

### Community 18 - "Device QR Pairing UI"
Cohesion: 0.27
Nodes (24): clearQr(), drawQr(), drawQrLink(), qrLinks, setQrStatus(), shownQrDeviceId(), showQr(), clearToken() (+16 more)

### Community 19 - "Subagent Feed Tests"
Cohesion: 0.21
Nodes (23): assistantLine(), publicDir, server, agentToolUse(), bgLaunch(), tests_server_transcripts_subagents_test_setup_createdashboardserver, cwd, fgResult() (+15 more)

### Community 20 - "Popups"
Cohesion: 0.23
Nodes (20): backdropCloses(), drawsSection(), escapeClosesPopup(), localDayKey(), openPopup(), PopupId, POPUPS, stillOpen() (+12 more)

### Community 21 - "Device Store"
Cohesion: 0.14
Nodes (13): createDeviceStore(), DeviceStore, devicesFilePath(), isStored(), loadDevices(), saveDevices(), StoredDevice, findByToken() (+5 more)

### Community 22 - "Audit Log Store"
Cohesion: 0.16
Nodes (19): DATA_DIR, APPROVALS_MAX, AUDIT_MAX_BYTES, AUDIT_MAX_ENTRIES, AuditFilter, LAUNCHES_MAX, parseAudit(), parseJson() (+11 more)

### Community 23 - "Session Summary Tests"
Cohesion: 0.10
Nodes (18): resetSummaryCache(), src_shared_types_index_sessionsummary, cwd, fx, longReply, path, publicDir, server (+10 more)

### Community 24 - "Shared API Types"
Cohesion: 0.22
Nodes (13): AlertInput, AlertKind, AlertsInfo, PermissionMode, LimitsInfo, PermissionRequestStatus, ProjectInfo, RecentSession (+5 more)

### Community 25 - "Claude CLI Wrapper"
Cohesion: 0.19
Nodes (19): claudeOnPath(), continueSession(), exitCodeOf(), jobId(), PROMPT_MAX, resolveClaudeBin(), run(), sessionLogs() (+11 more)

### Community 26 - "Git Workflow Rules"
Cohesion: 0.12
Nodes (20): Default git authorization (commit, push, PR, merge), test-runner, CI workflow check job (ci.yml), Conventional Commits and branch naming, Documentation-only changes skip checks, git parameters section, Skill: commit, Conventional Commits message format (+12 more)

### Community 27 - "Core Mood View"
Cohesion: 0.19
Nodes (13): createElement(), initCore(), updateCore(), CORE_LABEL, coreHeadline(), coreHeadlineParts(), CoreMood, coreSummary (+5 more)

### Community 28 - "Test Fixtures and Fake CLI"
Cohesion: 0.11
Nodes (13): Test conventions (makeFixture, fake CLI, raw(), mocked fetch), args, Fixture, RawResponse, slug(), alpha, currentState, detached (+5 more)

### Community 29 - "App Render Loop"
Cohesion: 0.22
Nodes (14): drawPopup(), render(), renderWarning, patchHtml(), renderAudit(), updateChat(), renderMessages(), updateApprovals() (+6 more)

### Community 30 - "Transcript Aggregates"
Cohesion: 0.16
Nodes (17): emptyTokens(), buildUsage(), addTokens(), dayAggFor(), isFirstSighting(), messages, modelTotals, projectLastActive (+9 more)

### Community 31 - "Transcript Indexing"
Cohesion: 0.21
Nodes (17): isSubagentPath(), parentSessionIdOf(), registerSubagent(), indexTranscript(), noteProjectActivity(), projectOf(), recordLimitHit(), consumeLines() (+9 more)

### Community 32 - "Build Asset Scripts"
Cohesion: 0.16
Nodes (11): SVG allowlist check (checkSvg) for skin artwork, esbuild, ref_node_child_process, ASSETS, copyAssets(), filesIn(), children, serverArgs (+3 more)

### Community 33 - "End-to-End Flow Tests"
Cohesion: 0.14
Nodes (13): Alert, alpha, AuditRow, auth, call(), device(), form, fx (+5 more)

### Community 34 - "CI and Agent Delegation"
Cohesion: 0.16
Nodes (16): CI workflow (ci.yml), CI job check (typecheck, lint, test on windows-latest, Node 24), CLAUDE.md project instructions, Mandatory agent delegation (frontend-developer, typescript-pro, git-workflow-manager), Fixed error strings to browser, OAuth token handling rule (read only in pollLive, never refresh), Usage shown in tokens only, no cost estimates, Tolerate mid-write session JSON (retry next tick) (+8 more)

### Community 35 - "Playwright Testing Skills"
Cohesion: 0.18
Nodes (16): frontend-tester, Playwright MCP browser tools, Skill: debug-test, Test failure cause classification (locator, timing, test logic, isolation, environment, app bug), No interactive Playwright modes (debug, ui, headed, show-report), Web-first retrying assertions instead of waitForTimeout, Skill: fix-flaky-tests, Prove fix with many repeated runs (+8 more)

### Community 36 - "Request Context and Identity"
Cohesion: 0.17
Nodes (9): ref_node_http, Identity, PC_DEVICE, Actor, AuthedCall, DashboardState, RequestCall, LiveStreams (+1 more)

### Community 37 - "Project Parameters"
Cohesion: 0.14
Nodes (15): Project parameters (project-params.md), architecture parameters section, docs parameters section, node parameters section, playwright parameters section, review parameters section, Sensitive areas (auth, server, claude-cli, limits, tls, client rendering), Test isolation via temp-dir fixtures and fakes (makeFixture, fake-claude.mjs) (+7 more)

### Community 38 - "Claude Data Sources"
Cohesion: 0.19
Nodes (14): Never write to ~/.claude or ~/.claude.json, cachedUsageUtilization fallback in .claude.json, Cross-session messages (queued_command attachment, SendMessage tool_use), Data sources (Claude Code internal files), Rate-limit hits (quotaLimits.status rejected), ~/.claude/sessions/<pid>.json live session files, Subagent hand-back detection, Token usage dedup by message.id + requestId (+6 more)

### Community 39 - "Chat View"
Cohesion: 0.31
Nodes (14): parseIntent(), bot(), chat, dismissAlert(), handle(), initChat(), line(), log() (+6 more)

### Community 40 - "Message Graph"
Cohesion: 0.28
Nodes (11): buildMessageGraph(), GRAPH_HEIGHT, GRAPH_WIDTH, GraphPoint, MessageEdge, MessageGraph, edgeHtml(), graphHtml() (+3 more)

### Community 41 - "Root Skin Scene"
Cohesion: 0.30
Nodes (14): curtain.svg (dark diagonal hanging-vine curtain backdrop), limbs.svg (dark trunk and limb silhouette, limbFade gradient), Root skin scene (Eywa / Tree of Souls), box(), buildFx(), buildHero(), buildSprite(), ensureRootScene() (+6 more)

### Community 42 - "Server Tests"
Cohesion: 0.14
Nodes (9): ref_node_net, apiPost(), fx, publicDir, server, fontBytes, fx, publicDir (+1 more)

### Community 43 - "Chat State"
Cohesion: 0.16
Nodes (7): ChatEntry, ChatRole, ChatState, createChatState(), HISTORY_MAX, PendingMessage, pending

### Community 44 - "TypeScript Config"
Cohesion: 0.14
Nodes (13): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleResolution, noEmit, skipLibCheck (+5 more)

### Community 45 - "VoltAgent Legacy Agents"
Cohesion: 0.31
Nodes (13): architect-reviewer, code-reviewer (archived VoltAgent version), Context manager query protocol (VoltAgent), node-specialist (archived VoltAgent version), test-automator (archived VoltAgent version), typescript-pro (archived VoltAgent version), debugger, frontend-developer (+5 more)

### Community 46 - "Login and Pair Pages"
Cohesion: 0.17
Nodes (9): Referrer-Policy same-origin, err, errorCode, ask, err, form, go, Login page (login.html) (+1 more)

### Community 47 - "Appearance and Skins"
Cohesion: 0.32
Nodes (9): applySkin(), initAppearance(), initSkin(), initTheme(), readStored(), writeStored(), parseSkin(), Skin (+1 more)

### Community 48 - "Alert Toasts"
Cohesion: 0.31
Nodes (9): badgeCount(), createAlertTracker(), renderAlerts(), row(), toast(), tracker, pendingCount(), Alert (+1 more)

### Community 50 - "Dependency Policy"
Cohesion: 0.20
Nodes (12): dependencies parameters section, No server runtime dependencies policy, qrcode-generator (bundled client devDependency), Skill: audit-dependencies, Install script review, Read-only dependency audit, Skill: resolve-conflicts, Intent-preserving conflict resolution (+4 more)

### Community 51 - "Code and Node Review Skills"
Cohesion: 0.18
Nodes (12): Skill: diff (change review), Severity-ranked review findings (blocker, major, minor), Skill: node-performance, Measured baseline and re-measure per change, Node performance suspects (blocked event loop, slow I/O, unbounded concurrency, buffering, leaks, slow startup), Skill: review-node, execFile/spawn with argument arrays, never shell: true, Process lifecycle and graceful shutdown (SIGTERM/SIGINT, close servers, unref timers) (+4 more)

### Community 52 - "Code Structure Test"
Cohesion: 0.17
Nodes (9): Feature folder map (tests mirror src), ENTRY_POINTS, FOLDER_MAP, listSourceFiles(), MISPLACED_ALLOWLIST, OVERSIZED_ALLOWLIST, SOURCE_ROOT, sourceFiles (+1 more)

### Community 53 - "npm Scripts"
Cohesion: 0.17
Nodes (12): scripts, build, build:css, build:html, build:js, dev, dev:lan, lint (+4 more)

### Community 54 - "Permission Hook Script"
Cohesion: 0.24
Nodes (6): ref_node_https, argValue(), decisionOutput(), post(), runHook(), TEXT_MAX

### Community 55 - "Seed Sprite Art"
Cohesion: 0.18
Nodes (12): seed-1.svg (seed strand slice 1), seed-10.svg (seed strand slice 10), seed-11.svg (seed strand slice 11), seed-2.svg (seed strand slice 2), seed-3.svg (seed strand slice 3), seed-4.svg (seed strand slice 4), seed-5.svg (seed strand slice 5), seed-6.svg (seed strand slice 6) (+4 more)

### Community 56 - "Toolkit Agent Protocols"
Cohesion: 0.60
Nodes (11): Handoffs protocol, Project procedures (sha256 drift check), code-reviewer, dependency-manager, Consults protocol (read-only, max two), documentation-engineer, git-workflow-manager, Forbidden git actions (never, even if asked) (+3 more)

### Community 57 - "Security Rules and Secrets"
Cohesion: 0.20
Nodes (11): .dashboard/ secrets folder (devices.json, alerts.json, TLS keys, commands.log), Loopback Host header guard (DNS-rebinding), server.ts request checks (Host guard, Sec-Fetch-Site, Origin, X-Dashboard, path traversal, security headers), Device endpoints (GET/POST /api/devices, revoke, pair), Failed sign-in alerts (signin:<address>), Layout section, Loopback exemption (pc device), QR pairing two-step flow (GET /pair peek, POST /pair spend) (+3 more)

### Community 58 - "CPU Measurement Script"
Cohesion: 0.35
Nodes (9): browserCandidates(), cdpClient(), cpuPercent(), findBrowser(), main(), parseArgs(), sample(), sleep() (+1 more)

### Community 59 - "State Stream and Settings UI"
Cohesion: 0.29
Nodes (8): connectStateStream(), initAlerts(), initSummarySetting(), updateSummaryNote(), api(), ApiError, src_shared_types_index_summary_modes, src_shared_types_index_summarysetting

### Community 60 - "Launch Controls"
Cohesion: 0.27
Nodes (10): matchSession(), fillPermissionModes(), fillProjectOptions(), updateControls(), launches, launchItemHtml(), loadLaunches(), renderLaunches() (+2 more)

### Community 61 - "Sessions List"
Cohesion: 0.38
Nodes (7): dotStateClass(), isBackgroundSession(), actionsHtml(), sessionRowHtml(), sumTokens(), src_shared_types_index_recentsession, src_shared_types_index_sessioninfo

### Community 62 - "Login Limiter and Pairing"
Cohesion: 0.18
Nodes (3): AuthParts, LoginLimiter, PairingStore

### Community 63 - "Limits Polling"
Cohesion: 0.27
Nodes (10): CLAUDE_DIR, getLimits(), LABELS, pollLive(), readCache(), Snapshot, toWindows(), limitHits (+2 more)

### Community 64 - "Alerts Tests"
Cohesion: 0.20
Nodes (6): src_shared_types_index_limitsinfo, src_shared_types_index_teamboard, file, fx, limits(), signins()

### Community 65 - "Client XSS and Page Shell"
Cohesion: 0.22
Nodes (10): Client XSS rules (esc(), data-tip via textContent, no inline scripts), Permission mode allowlist (plan, default, acceptEdits, auto), Dashboard page (index.html), Needs attention panel (#alerts), Approvals panel (#approvals), Project building dialog (#building), Ask the dashboard chat panel (#chat), Transcript drawer with follow-up form (#drawer) (+2 more)

### Community 66 - "UI Conventions"
Cohesion: 0.29
Nodes (10): No inline styles in new client code, Animations always run (no prefers-reduced-motion), Project colours by alphabetical name, Self-hosted fonts with OFL licences, Skins (Classic, Co-pilot, Root) swapping CSS tokens, UI conventions, OFL licence: Cormorant Garamond, OFL licence: JetBrains Mono (+2 more)

### Community 67 - "Package Manifest"
Cohesion: 0.20
Nodes (9): name, private, type, version, eslint, @eslint/js, sass, @types/node (+1 more)

### Community 68 - "Device List Logic"
Cohesion: 0.36
Nodes (7): cleanName(), createdLabel(), lastSeenLabel(), pad(), sortDevices(), row(), src_shared_types_index_deviceinfo

### Community 69 - "Auth Tests"
Cohesion: 0.40
Nodes (6): count, DAY, fx, reqWith(), setup(), sidFrom()

### Community 70 - "Command Execution Rules"
Cohesion: 0.22
Nodes (9): Command execution rules (execFile arg arrays, no shell, audit, max 4 processes), Prefix for prompts starting with "-", LAN mode (HTTPS + login, --lan / DASHBOARD_HOST), Dashboard as remote-execution surface, Architecture and reference (docs/architecture.md), Claude CLI binary lookup order, Environment variables (DASHBOARD_*, PROJECTS_ROOT, CLAUDE_*, TEAM_HQ_DIR), Model summaries via claude -p haiku (stdin excerpt, no tools) (+1 more)

### Community 71 - "Dev Dependencies"
Cohesion: 0.22
Nodes (9): devDependencies, esbuild, eslint, @eslint/js, qrcode-generator, sass, @types/node, typescript (+1 more)

### Community 72 - "Loopback Detection"
Cohesion: 0.32
Nodes (7): hostnameOf(), isLocalPeer(), isLoopbackRequest(), LOOPBACK_ADDRESSES, LOOPBACK_HOSTS, ownAddresses(), PROXY_HEADERS

### Community 73 - "Test Coverage Skills"
Cohesion: 0.29
Nodes (7): Advisories ranked by real risk (reachability, prod vs dev), Skill: coverage-gaps, Coverage gaps ranked by business risk, Skill: write-tests, Arrange-act-assert, one behavior per test, Reproduce bugs with a failing test first, Mock external services at module boundaries, no live services

### Community 74 - "TypeScript Migration Skills"
Cohesion: 0.33
Nodes (7): Skill: migrate-to-typescript, Gradual strictness raising (noImplicitAny, strictNullChecks, strict, noUncheckedIndexedAccess), Leaves-up per-module JS to TS conversion, Skill: type-design, Discriminated unions with exhaustiveness checks, Avoid any, double casts, non-null assertions and ts-ignore; ts-expect-error with reason, unknown and narrowing at boundaries, no unchecked casts

### Community 76 - "Performance Notes"
Cohesion: 0.40
Nodes (6): In-place DOM patching (patchHtml, data-key), Performance: CPU of an open dashboard tab (docs/perf.md), CPU after F-004 (230235b: 0.16% / 0.10%), CPU baseline (20fcd90: ~0.63%), CPU measurement via CDP TaskDuration (headless Chrome/Edge), cpuPercent pure function

### Community 77 - "ESLint Config"
Cohesion: 0.33
Nodes (5): LEGACY_FILES exemption list (empty, may only shrink), FORBIDDEN_ABBREVIATIONS, LEGACY_FILES, readabilityRules, typescript-eslint

### Community 78 - "QR Code Logic"
Cohesion: 0.47
Nodes (3): qrcode-generator, QR_MARGIN, qrShape

### Community 79 - "Tree Layer Art"
Cohesion: 0.53
Nodes (6): tree-1.svg (willow strand layer 1, wlg gradient), tree-2.svg (willow strand layer 2, wlg gradient), tree-3.svg (willow strand layer 3, wlg gradient), tree-4.svg (willow strand layer 4, wlg gradient), tree-glow.svg (lavender glow underlay of tree strands), Tree of Souls layer stack (glow + 4 shimmer layers)

### Community 80 - "Permission Hook Route"
Cohesion: 0.47
Nodes (5): UUID_RE, requestText(), handlePermissionHook(), holdRequest(), LOOPBACK_ADDRESSES

### Community 81 - "Summary Settings"
Cohesion: 0.73
Nodes (4): FILE(), getSummaryMode(), setSummaryMode(), handleSettingsRoutes()

### Community 82 - "MCP Config"
Cohesion: 0.50
Nodes (3): npx, playwright, @playwright/mcp

## Knowledge Gaps
- **267 isolated node(s):** `npx`, `@playwright/mcp`, `FORBIDDEN_ABBREVIATIONS`, `readabilityRules`, `name` (+262 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 440 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `CLAUDE.md project instructions` connect `CI and Agent Delegation` to `Client XSS and Page Shell`, `Project Parameters`, `Claude Data Sources`, `Command Execution Rules`, `Code and Node Review Skills`, `Security Rules and Secrets`?**
  _High betweenness centrality (0.146) - this node is a cross-community bridge._
- **Why does `Skill: diff (change review)` connect `Code and Node Review Skills` to `Toolkit Agent Protocols`, `CI and Agent Delegation`, `Project Parameters`?**
  _High betweenness centrality (0.087) - this node is a cross-community bridge._
- **Why does `code-reviewer` connect `Toolkit Agent Protocols` to `Code and Node Review Skills`, `Project Parameters`, `VoltAgent Legacy Agents`, `Playwright Testing Skills`?**
  _High betweenness centrality (0.068) - this node is a cross-community bridge._
- **What connects `npx`, `@playwright/mcp`, `FORBIDDEN_ABBREVIATIONS` to the rest of the system?**
  _267 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Building Annex View` be split into smaller, more focused modules?**
  _Cohesion score 0.07932692307692307 - nodes in this community are weakly interconnected._
- **Should `Audit and Permissions UI` be split into smaller, more focused modules?**
  _Cohesion score 0.07191961924907457 - nodes in this community are weakly interconnected._
- **Should `DOM Patching` be split into smaller, more focused modules?**
  _Cohesion score 0.05367231638418079 - nodes in this community are weakly interconnected._