---
name: write-test
description: "Procedure for writing or reviewing Playwright tests: explore the live app with MCP, generate selectors, write arrange-act-assert tests with page objects, verify against sample data, and review for maintainability."
argument-hint: "<URL, feature, or user flow to test>"
allowed-tools: [Bash, Read, Grep, Glob, Edit, Write, mcp__playwright__browser_navigate, mcp__playwright__browser_snapshot, mcp__playwright__browser_find, mcp__playwright__browser_generate_locator, mcp__playwright__browser_click, mcp__playwright__browser_type, mcp__playwright__browser_fill_form, mcp__playwright__browser_select_option, mcp__playwright__browser_press_key, mcp__playwright__browser_hover, mcp__playwright__browser_verify_element_visible, mcp__playwright__browser_verify_text_visible, mcp__playwright__browser_verify_value]
---

Write or review tests for: $ARGUMENTS

Wherever a step says to ask the user: in a main session, ask. When running as the frontend-tester
subagent, state the assumption and return the question. Write test files; do not run them unless
the delegation prompt authorizes running tests.

## Steps

1. Understand the feature: read the component/page code, its inputs and HTML, and the user flow
   that should be tested.
2. Explore with MCP (if available, otherwise read the code and mark selectors "unverified"):
   - Navigate: `browser_navigate(url)`.
   - Snapshot: `browser_snapshot()` to see the accessibility tree and find elements by role/label.
   - Generate: `browser_generate_locator()` for elements you plan to interact with.
   - Verify: `browser_verify_element_visible()`, `browser_verify_text_visible()` to confirm the
     starting state.
3. Organize the test: file path in `tests/<feature>/` (e.g., `tests/auth/login.spec.ts`),
   grouped in `describe` blocks by page or feature.
4. Write the test in Playwright Test:
   - Arrange: set up the test (navigate, seed data, mock APIs with `page.route`).
   - Act: perform the user action (click, type, select, press key, submit).
   - Assert: verify the result (element visible, text appears, URL changed, network request made).
5. Selectors and interactions:
   - Use `data-testid` where present. Otherwise: `getByRole` (button, checkbox, etc.), `getByText`
     (visible text), `getByLabel` (form inputs), `getByPlaceholder`. Avoid CSS selectors on DOM
     structure.
   - Web-first assertions: `await expect(locator).toBeVisible()`, `toHaveText()`, `toHaveValue()`.
     Never hardcode `page.waitForTimeout(1000)`.
   - Wait for navigation: `await page.goto(url)`, then assertions. Wait for URL change:
     `await expect(page).toHaveURL(new RegExp('/dashboard'))`.
   - Parameterize across data: use a loop, not `test.each`:
     ```javascript
     for (const user of [{email: 'a@x.com', pass: 'p1'}, ...]) {
       test(`login as ${user.email}`, ...)
     }
     ```
   - Parameterize across browsers through the `projects` in `playwright.config.ts`, not in the
     test: Playwright runs every test once per project. Each project's browser must be installed.
6. Page objects (only if reused in multiple tests):
   ```typescript
   class LoginPage {
     constructor(readonly page: Page) {}
     goto() { return this.page.goto('/login'); }
     fill(email, password) { ... }
     getErrorMessage() { ... }
   }
   ```
   Use page objects to hide selectors and keep tests readable.
7. Fixtures and `beforeEach` for reusable state (login, create data), with the same locator
   rules as the tests themselves:
   ```typescript
   test.beforeEach(async ({ page }) => {
     await page.goto('/login');
     await page.getByLabel('Email').fill('test@example.com');
     await page.getByLabel('Password').fill('test-password');
     await page.getByRole('button', { name: 'Log in' }).click();
     await expect(page).toHaveURL(/\/dashboard/);
   });
   test('shows the dashboard after login', async ({ page }) => {
     await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
   });
   ```
   When many tests need a logged-in user, log in once in a setup project and reuse the saved
   `storageState` instead of repeating the login in every test. Use test accounts only.
8. Verify before declaring it done:
   - Read the test: is it clear and maintainable?
   - Selectors: are they stable (not tied to styling)?
   - Isolation: does the test depend on other tests or shared state? Use fixtures and
     `beforeEach`.
   - Correctness: does it actually test what it claims?
9. Report: test file paths, the user flow tested, any assumptions about selectors (which came from
   MCP, which are unverified), and whether setup or fixtures were needed.
