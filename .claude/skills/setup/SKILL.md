---
name: setup
description: "Procedure for setting up Playwright Test in a project: detect the package manager, install @playwright/test and only the browsers the config uses, create a non-interactive playwright.config with webServer, list and html reporters and traces, add scripts and ignore rules, and verify with one passing test. Followed by the frontend-tester agent; in a main session, delegate Playwright setup to that agent."
argument-hint: "[app start command and base URL, if not obvious]"
allowed-tools: [Bash, Read, Write, Edit, Glob]
---

Set up Playwright Test for this project: $ARGUMENTS

Wherever a step says to ask the user: in a main session, ask. When running as the
frontend-tester subagent, state the assumption and return the question. Everything is
project-local: never install packages or browsers globally.

## Steps

1. Find the package folder (a repo can contain several packages; use the one with the frontend
   app) and its package manager from the lockfile: `package-lock.json` npm, `pnpm-lock.yaml`
   pnpm, `yarn.lock` yarn. Find how the app starts in development (`dev`, `serve` or `start` in
   `package.json` scripts) and the URL and port it serves on.
2. If `@playwright/test` is already a dependency and a `playwright.config.*` exists, report the
   version and the config, and stop; extend the existing setup instead of replacing it.
3. Install the test runner as a dev dependency: `npm i -D @playwright/test` (or `pnpm add -D`,
   `yarn add -D`). Report the `package.json` and lockfile change.
4. Create `playwright.config.ts` (or `.js` if the project has no TypeScript). Start with one
   browser; more projects can be added later, and each needs its browser installed:
   ```typescript
   import { defineConfig, devices } from '@playwright/test';

   export default defineConfig({
     testDir: './tests/e2e',
     fullyParallel: true,
     forbidOnly: !!process.env.CI,
     retries: process.env.CI ? 2 : 0,
     reporter: [['list'], ['html', { open: 'never' }]],
     use: {
       baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
       trace: 'on-first-retry',
       screenshot: 'only-on-failure',
     },
     projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
     webServer: {
       command: 'npm run dev',
       url: 'http://localhost:3000',
       reuseExistingServer: !process.env.CI,
       timeout: 120_000,
     },
   });
   ```
   Adjust `testDir` to the project's convention (if it already has an e2e folder, use it),
   `baseURL`, `webServer.url` and `webServer.command` to the real dev command and port. The
   `html` reporter must have `open: 'never'`: its default opens a report server after a failed
   run and waits, which blocks an unattended agent.
5. Install exactly the browsers the config's `projects` use: `npx playwright install chromium`
   (add `firefox` or `webkit` only if those projects exist). On Linux, browsers may also need
   system libraries; `npx playwright install --with-deps` installs them but needs root, so do not
   run it; return it as a command for the user if the first run reports missing libraries.
6. Add a script to `package.json`: `"test:e2e": "playwright test"`.
7. Add to `.gitignore`: `test-results/`, `playwright-report/`, `blob-report/`,
   `playwright/.cache/`.
8. Verify with one small test (`tests/e2e/smoke.spec.ts`) that opens `/` and asserts something
   stable, such as the page title or a main landmark, using a web-first assertion. Run
   `npx playwright test` and report the result. Keep the smoke test unless the request says
   otherwise; it proves the setup works.
9. Report: files created or changed, commands run, the browsers installed, the run result, and
   the `package.json` and lockfile changes for whoever commits them.
