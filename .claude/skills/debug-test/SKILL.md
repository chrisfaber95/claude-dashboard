---
name: debug-test
description: "Procedure for debugging a failing or flaky Playwright test unattended: reproduce with traces and screenshots, compare the test with the live page through Playwright MCP snapshots, classify the cause (locator, timing, test logic, isolation, app bug), fix the test with web-first assertions, and prove it with repeated runs. Followed by the frontend-tester agent; in a main session, delegate Playwright test debugging to that agent."
argument-hint: "<test title or file>"
allowed-tools: [Bash, Read, Grep, Glob, Edit, mcp__playwright__browser_navigate, mcp__playwright__browser_snapshot, mcp__playwright__browser_find, mcp__playwright__browser_generate_locator, mcp__playwright__browser_console_messages, mcp__playwright__browser_network_requests, mcp__playwright__browser_click, mcp__playwright__browser_type, mcp__playwright__browser_fill_form]
---

Debug the test: $ARGUMENTS

Wherever a step says to ask the user: in a main session, ask. When running as the
frontend-tester subagent, state the assumption and return the question. Never use interactive
modes (`--debug`, `--ui`, `--headed`, `show-trace`, `show-report`); they wait for a person.
Do not change application code to make a test pass.

## Steps

1. Reproduce with evidence. Make sure the app is reachable (see the `run-tests` skill), then
   run the test alone: `npx playwright test <file> -g "<title>" --trace on --reporter=list`.
   Record the error message and the failing line. Read the artifacts in
   `test-results/<test-folder>/`: the screenshot, the `error-context.md` page state if present,
   and the trace (`trace.zip` contains the action log; read what you can, and do not open the
   trace viewer). If it passes, run it with `--repeat-each=5` and alone versus in the full file
   to see how often and when it fails.
2. Look at the real page with the Playwright MCP tools: `browser_navigate` to the same URL,
   repeat the user steps the test performs (`browser_click`, `browser_type`, `browser_fill_form`),
   take a `browser_snapshot` at the failing step, and check `browser_console_messages` and
   `browser_network_requests` for errors. Use `browser_generate_locator` to get a robust locator
   for the element the test targets. If the MCP tools are unavailable, read the component code
   instead and say the comparison is unverified.
3. Classify the cause:
   - **Locator**: the element is not found, or several match. Replace CSS or position-based
     locators with role, label, text or `data-testid` locators, and make them unique.
   - **Timing**: the test acts before the page is ready. Use web-first assertions that retry
     (`await expect(locator).toBeVisible()`, `toHaveText`, `toHaveURL`) and `page.waitForURL` for
     navigation. Never add `waitForTimeout`, and do not use `waitForSelector` or
     `waitForNavigation` where an assertion does the job.
   - **Test logic**: wrong URL, step, data or assertion for the intended flow. Fix the test to
     match the flow.
   - **Isolation**: depends on order, on data left by another test, or on shared login state.
     Give it its own data or fixture, reset state in `beforeEach`, and use a fresh context.
   - **Environment**: the app, backend or test data is not what the test expects (server not
     started, missing seed data). Fix the setup or report what is missing.
   - **App bug**: the app does not do what the user flow requires. The test is right. Do not
     change application code; report the bug with the failing test, the evidence and a hand-off
     to whoever owns the app code.
4. Fix only the test (or its fixtures and config) for the first five causes, keeping the change
   minimal.
5. Prove it: run the test with `--repeat-each=5 --reporter=list`, alone and with its file. A
   flaky test is fixed only when every repetition passes.
6. Report: the cause with evidence (error, screenshot or snapshot finding), the change made, the
   before and after results, and any app bug or environment problem found.
