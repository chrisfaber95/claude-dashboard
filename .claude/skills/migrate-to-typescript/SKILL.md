---
name: migrate-to-typescript
description: "Procedure for incrementally migrating a JavaScript codebase to TypeScript, or raising strictness step by step, without changing runtime behavior: tsconfig setup with allowJs, per-module conversion from the leaves up, shared types, build and tooling changes, and verification after each step. Followed by the typescript-pro agent; in a main session, delegate TypeScript migration to that agent."
argument-hint: "<package, folder or strictness step to migrate>"
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep]
---

Migrate: $ARGUMENTS

Wherever a step says to ask the user: in a main session, ask. When running as the
typescript-pro subagent, state the assumption and return the question. Only migrate what the
request names. Behavior must not change; the tests are the proof.

## Steps

1. Establish a safety net first: run the existing tests, lint and build and record the results.
   If there are no tests for the code you will convert, say so; a migration without tests only
   proves it compiles. Do not start a large migration on untested critical code without
   reporting that risk.
2. Set up TypeScript beside the JavaScript, not instead of it:
   - install `typescript` as a dev dependency, plus the type packages the project's libraries
     need (`@types/node` and `@types/<package>` where a library ships no types)
   - add a `tsconfig.json` with `allowJs: true`, `checkJs: false` at first, `noEmit` if a
     separate tool builds the code, a `target` and `module` that match the runtime (check the
     Node version and the module system), and `include` limited to the package being migrated
   - add a `typecheck` script (`tsc --noEmit`)
   - choose the runtime and dev tooling the project can support (compile with `tsc`, run with
     `tsx`, or let the bundler handle it) and change as little of the build as possible
3. Convert from the leaves up: modules that import nothing from the project first (utilities,
   constants, small helpers), then the modules that use them. Convert one module or a few small
   related ones per step: rename `.js` to `.ts`, add types to exports and parameters, and fix
   what the compiler reports. Keep the logic exactly as it is.
4. Put types for shared shapes (API requests and responses, database rows, config) in one
   place and import them, rather than redefining them per file. Type external data as
   `unknown` and narrow it; follow the `type-design` rules for unions and boundaries if that
   skill is available, otherwise the same principles.
5. Raise strictness gradually, one flag at a time, only after the current level compiles
   cleanly: first `noImplicitAny`, then `strictNullChecks`, then the rest of `strict`, and
   consider `noUncheckedIndexedAccess` last. Commit-sized steps: do not enable `strict` for a
   whole codebase in one go and then fight hundreds of errors.
6. Imports and exports: keep the module system the project already uses. Watch for import path
   extensions that ESM requires, default versus named import interop, and `require` calls that
   need rewriting. Update lint configuration to a TypeScript-aware parser only if the project
   already lints and the change is needed.
7. After each step run the type check, the tests, lint and the build, and fix regressions
   before moving on. If a conversion changes behavior (a type error that exposes a real bug),
   stop and report it rather than fixing it silently inside a migration.
8. Update documentation of scripts and the setup (README or the project's docs) if commands
   changed.
9. Report: what was converted, the strictness level reached, the before and after error counts,
   build and tooling changes, remaining JavaScript, bugs the compiler exposed, and the next
   suggested step. Say plainly what was not verified.
