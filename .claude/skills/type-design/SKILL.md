---
name: type-design
description: "Procedure for designing and fixing TypeScript types: model states with discriminated unions, narrow safely, use unknown and runtime validation at boundaries, constrain generics, avoid over-engineered type-level code, and prove the types with the compiler. Followed by the typescript-pro agent; in a main session, delegate type design to that agent."
argument-hint: "<code, type errors or feature to type>"
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep]
---

Design or fix the types for: $ARGUMENTS

Wherever a step says to ask the user: in a main session, ask. When running as the
typescript-pro subagent, state the assumption and return the question.

## Steps

1. Baseline: run the type check (`npx tsc --noEmit` or the `typecheck` script) and note the
   existing error count and the strictness flags in use. You must not make this worse.
2. Understand what the code really does at runtime before typing it: read the callers, the
   data sources and the tests. Types describe reality; do not invent a shape the data does not
   have.
3. Model state precisely:
   - a closed set of cases as a discriminated union with a literal `kind` or `status` field,
     rather than several optional fields and booleans
   - make impossible states unrepresentable (a `loading` state has no `data`; a `success` state
     does)
   - check exhaustiveness: a `switch` over a union ends with a `default` branch that assigns the
     value to `never`
   - use `readonly` and `as const` for data that should not change; use `satisfies` to check a
     value against a type without widening it
4. Boundaries (HTTP responses, environment variables, files, JSON, `catch` variables): type
   them as `unknown`, then narrow with type guards or a runtime schema if the project already
   uses a validation library (and let it infer the type). A cast like `as User` on external data
   is a promise the compiler cannot check; avoid it or isolate it in one documented function.
5. Functions: type parameters and return values explicitly at module boundaries, and let
   inference work inside bodies. Use overloads only when the return type truly depends on the
   input shape. Prefer a union of options objects to long positional parameter lists.
6. Generics: add a type parameter only when the relationship between input and output types
   must be preserved, and constrain it (`<T extends { id: string }>`). If a generic type needs
   many lines of conditional or mapped types to read, simplify it or accept a less clever
   type. Prefer the built-in utilities (`Pick`, `Omit`, `Partial`, `Required`, `Record`,
   `ReturnType`, `Awaited`) to hand-written ones.
7. Branded types for identifiers that must not be mixed (`UserId` and `OrderId`) are worth it
   only where such a mix-up is a real risk; keep the constructor in one place.
8. Fixing errors: understand each one. The right fix is usually a better type, a narrowing check
   or a changed signature. Do not reach for `any`, `as unknown as`, `!` or `@ts-ignore`. When a
   suppression is genuinely needed, use `@ts-expect-error` with a one-line reason so it fails
   when the problem goes away.
9. Verify: run the type check again and report the before and after error counts, then lint
   and the tests. For types that matter (a public API, a tricky generic), add a small type
   test with the project's tooling (for example `expectTypeOf` in Vitest, or `tsd`); if none
   exists, a few `// @ts-expect-error` lines in a test file that must fail to compile also
   work.
10. Report: files changed, the main typing decisions and why, the verification results, real
    bugs the types exposed, and remaining errors you left alone.
