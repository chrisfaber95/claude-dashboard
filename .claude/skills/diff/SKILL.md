---
name: diff
description: "Procedure for reviewing a code change: understand the intent, read the diff in context, check correctness, error handling, security, tests, performance and maintainability against the project's own rules, and report severity-ranked findings with file, line and a concrete failure scenario. Read-only. Followed by the code-reviewer agent; in a main session, delegate change reviews to that agent."
argument-hint: "<working tree, branch, PR number or files to review>"
allowed-tools: [Read, Glob, Grep, Bash]
---

Review: $ARGUMENTS

Wherever a step says to ask the user: in a main session, ask. When running as the code-reviewer
subagent, state the assumption and return the question. This is read-only: report findings; do
not edit files or change git state.

## Steps

1. Get the change and its intent. For local work use `git diff` and `git diff --staged`; for a
   branch, `git diff <base>...HEAD`; for a PR, `gh pr view <n>` and `gh pr diff <n>`. Read the
   commit messages and the description. State in one sentence what the change is supposed to do.
   If the change is very large or mixes unrelated things, say so; that is itself a finding.
2. Read the project's review rules (CLAUDE.md, `.claude/project-params.md` or a root WORKFLOW.md, any docs rules on
   architecture, testing, dependencies, security). Note the ones that apply.
3. Read each changed file in context: the whole function, its callers, and the code it calls.
   Hunks alone hide bugs. Open the tests that cover the change.
4. Correctness first. Trace the behavior for the normal case, then the edges: empty and null
   inputs, boundaries and off-by-one, duplicates, ordering, time zones and rounding, concurrent
   access and race conditions, partial failure, retries, and what happens on error paths and
   when an external call fails or is slow. Check that resources are released and that async
   code is awaited and its errors handled.
5. Security: apply the `security` skill's checks to anything touching authentication,
   authorization, user input, queries, files, secrets, or external requests.
6. Tests: do the tests cover the new behavior and the failure paths, do they assert real
   results (not only that something ran), are they deterministic, and do they avoid live
   databases and services as the project requires? A bug fix should come with a test that fails
   without the fix. If it is safe and local, run the relevant tests and lint, and report the
   results; if you cannot, say so.
7. Design and maintainability, only where it affects future cost: logic in the wrong layer,
   duplicated logic, unclear names that will mislead, hidden coupling, unnecessary abstraction
   or configuration, dead code the change introduced, changes outside the stated scope. Do not
   report taste or anything the formatter and linter enforce.
8. Performance, only when it is plausible at the project's scale: queries in loops, unbounded
   result sets, work in the request path that could be deferred, missing indexes for new query
   patterns.
9. Dependencies and config: new dependencies justified against the project's policy, lockfile
   changes consistent with `package.json`, no secrets or environment-specific values committed.
10. Rank findings: **blocker** (wrong behavior, data loss, security hole, breaks the build or
    tests), **major** (fails under realistic conditions, missing test for important logic, rule
    violation), **minor** (small improvement). Each has file and line, what is wrong, the
    concrete scenario in which it fails, and a minimal suggested fix. Merge duplicates, keep it
    short, and drop anything you are not reasonably sure about, or label it a question.
11. Report the verdict, the findings, what you checked and ran, and what you could not check. If
    you found no problems, say what you examined so the statement is worth something, and name
    one or two things the change does well.
