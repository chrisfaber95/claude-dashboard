---
name: audit-dependencies
description: "Procedure for a read-only dependency audit: vulnerabilities with reachability and severity, outdated packages, unused and duplicate packages, install scripts, licenses and maintenance health, ranked by real risk. Followed by the dependency-manager agent; in a main session, delegate dependency audits to that agent."
argument-hint: "<package folder or project to audit>"
allowed-tools: [Read, Glob, Grep, Bash]
---

Audit the dependencies of: $ARGUMENTS

Wherever a step says to ask the user: in a main session, ask. When running as the
dependency-manager subagent, state the assumption and return the question. This is read-only:
do not change `package.json`, lockfiles or install anything.

## Steps

1. Work in the package folder named in the request. List direct dependencies and dev
   dependencies from `package.json`, and note the package manager and lockfile. Check that the
   lockfile is in sync (`npm ci --dry-run`, or the manager's equivalent, if available).
2. Vulnerabilities: run the manager's audit (`npm audit --json`; pnpm and yarn have equivalents).
   It needs network access to the advisory database; if it fails, say the vulnerability audit is
   incomplete. Use `--omit=dev` as a second view of what ships to production.
3. Judge each advisory instead of copying the count: severity, whether the vulnerable package is
   a direct or transitive dependency (`npm ls <package>` shows the path), whether it is a dev
   tool or runs in production, and whether the vulnerable function or condition applies to how
   the project uses it (read the advisory and search the code). Rank real risk above raw count.
4. Outdated: `npm outdated` shows current, wanted and latest versions. Classify the gap: patch,
   minor, major. Flag packages that are far behind or no longer receive updates, and the runtime
   itself if the Node version in use is out of support.
5. Unused: for each direct dependency, search the code, configuration, scripts and tool configs
   for any use, including dynamic imports and tools referenced only from `package.json` scripts
   or config files. Run `npx depcheck` if you want a second opinion, and treat its output as a
   candidate list, not as proof; it misses dynamic use.
6. Duplicates and size: multiple versions of the same package in the tree (`npm ls <package>`),
   heavyweight packages used for a small feature that the platform or an existing dependency
   already provides, and for frontend projects the largest contributors to the bundle if a
   report is available.
7. Install scripts: list the packages that declare `preinstall`, `install` or `postinstall`
   scripts (`npm query ":attr(scripts, [postinstall])"` or read each package's `package.json`
   under `node_modules`). Read what the scripts do and flag anything that downloads or executes
   code. Compare with the project's policy for install scripts.
8. Licenses and health: list the licenses of direct dependencies (`npm ls --json` plus each
   package's `license` field, or `npx license-checker --summary`) and flag licenses the project
   cannot use if its docs say so. Flag packages that look abandoned (no release for years, an
   archived repository) when you can verify it from registry metadata (`npm view <pkg> time`).
9. Report: a short verdict, then the findings ranked by real risk (exploitable vulnerabilities
   in production dependencies first), each with the evidence (the command output, the advisory
   id, the dependency path), a recommended action, and the effort. List what you could not
   check.
