---
name: run-tests
description: "Procedure for running Playwright tests unattended and reporting the results: make sure the app is reachable (webServer config, an already running server, or a dev server started and stopped by the agent), run non-interactively, and report counts, failures and artifact paths. Followed by the frontend-tester agent; in a main session, delegate Playwright test runs to that agent."
argument-hint: "[test file or pattern, project name]"
allowed-tools: [Bash, Read, Grep, Glob]
---

Run the Playwright tests and report: $ARGUMENTS

Wherever a step says to ask the user: in a main session, ask. When running as the
frontend-tester subagent, state the assumption and return the question. Run against localhost
only, unless the delegation prompt names another URL. Never use interactive modes (`--debug`,
`--ui`, `--headed`, `show-report`, `show-trace`): nobody is there to close them and the run
hangs.

## Steps

1. Preconditions: `@playwright/test` is installed (`npx playwright --version`) and a
   `playwright.config.*` exists. If not, use the `setup` skill first, or report what is missing.
2. Make sure the app is reachable, in this order:
   1. The config has a `webServer`: Playwright starts the app, waits for its URL and stops it
      afterwards. Nothing else to do.
   2. No `webServer`, but the `baseURL` already responds (`curl -s -o /dev/null -w "%{http_code}"
      <baseURL>`): use the running app and leave it running.
   3. Neither: start the dev script from `package.json` in the background, poll the `baseURL`
      every two seconds for up to two minutes, and stop exactly that process after the run. If it
      does not come up, report the startup output and stop. Missing prerequisites (a database, a
      backend, secrets in `.env`) are reported, not guessed.
3. Run non-interactively with a plain reporter:
   - everything: `npx playwright test --reporter=list`
   - one file or pattern: `npx playwright test <path or pattern> --reporter=list`
   - one browser project: add `--project=<name>`
   On CI-like runs, `CI=1` keeps retries and `forbidOnly` behavior identical to the pipeline.
4. Read the result: the summary line (passed, failed, flaky, skipped), and for each failure the
   test title, the file and line, and the first error message. Artifacts per failed test are in
   `test-results/<test-folder>/`: a screenshot, an `error-context.md` with the page state if the
   Playwright version writes it, and a `trace.zip` when traces are on. A test marked flaky
   passed only on retry; report it as flaky, not as passing.
5. If asked to check flakiness, re-run the test alone with `--repeat-each=5 --reporter=list`
   and report how many of the runs failed.
6. Stop any dev server you started in step 2.3, and confirm the port is free again.
7. Report: the command run, the counts, each failure with its first error line and artifact
   paths, flaky tests, and anything that kept the run from starting. Report only what the output
   showed.
