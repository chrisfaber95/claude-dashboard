---
name: upgrade-dependencies
description: "Procedure for upgrading dependencies safely: one package or coherent group at a time, changelog review for breaking changes, lockfile updated only by the package manager, install scripts reviewed, tests lint and build after each step, and a rollback if it fails. Followed by the dependency-manager agent; in a main session, delegate upgrades to that agent."
argument-hint: "<packages or upgrade goal, and the package folder>"
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep]
---

Upgrade: $ARGUMENTS

Wherever a step says to ask the user: in a main session, ask. When running as the
dependency-manager subagent, state the assumption and return the question. Upgrade only what the
request names or clearly implies (for example "fix the high advisories"); do not widen the
scope.

## Steps

1. Baseline: in the package folder, install from the lockfile (`npm ci`) if `node_modules` is
   missing or stale, then run the project's lint, tests and build and record the results. If
   the baseline already fails, say so and stop; do not upgrade on a red baseline.
2. Plan the order. Patch and minor updates first, then each major update on its own. Group only
   packages that must move together (a framework and its plugins, a library and its type
   packages). For a security fix, find the fixed version range in the advisory and prefer the
   smallest upgrade that reaches it.
3. For each step, before changing anything, read the release notes or changelog between the
   current and target version (`npm view <pkg> version homepage repository.url`, then the
   repository's changelog). Write down the breaking changes that apply to how this project uses
   the package, and check that the new version supports the project's Node version and its
   other dependencies' peer requirements.
4. Upgrade with the package manager, never by hand-editing the lockfile:
   `npm install <pkg>@<version>` (or `pnpm add`, `yarn add`). Do not use `--force` or
   `--legacy-peer-deps` to get past a peer conflict; report the conflict. Do not run
   `npm audit fix --force`.
5. Install scripts: if the new or upgraded package, or something it pulls in, runs install
   scripts, read what they do before accepting them, and follow the project's install-script
   policy and the package manager's mechanism for approving them. Do not approve scripts you
   have not read.
6. Adapt the code to real breaking changes with the smallest change, based on the changelog and
   the compiler or test failures, not guesses. If the fix is large, stop the step and report it
   as a follow-up rather than sprawling.
7. Verify after each step: run lint, tests and build. For frontend projects start the dev
   server or run the build to catch runtime import errors. Compare with the baseline. If it
   fails and the cause is not a small, clear fix, roll the step back by reinstalling the
   previous version (`npm install <pkg>@<old-version>`) so the lockfile returns to its previous
   state, confirm the baseline passes again, and report why it failed.
8. Run the audit again at the end and report which advisories are resolved and which remain.
9. Report: each package with the old and new version and why, the breaking changes handled, the
   code changes made, the test, lint and build results before and after, packages you could not
   upgrade (with the reason), install scripts found, and the exact `package.json` and lockfile
   changes for the person who will commit.
