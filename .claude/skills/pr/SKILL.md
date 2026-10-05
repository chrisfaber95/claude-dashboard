---
name: pr
description: "Procedure for opening a GitHub pull request with gh for the current branch: Conventional Commits title and a structured description (Summary, Why, Changes, Architecture, Testing, Validation, Known limitations, Revision). Followed by the git-workflow-manager agent; in a main session, delegate PRs to that agent rather than running this directly."
argument-hint: "[base branch, default: repo default branch]"
allowed-tools: [Bash, Read, Grep]
---

Open a pull request for the current branch. Base branch (may be empty): $ARGUMENTS

Every unit of work gets a PR; never merge a branch into the default branch directly.

Confirmation: in a main session, ask the user before pushing or creating the PR. When running as
the git-workflow-manager subagent, push or create the PR only if the delegation prompt authorized
it ("push", "open the PR"). Otherwise stop after drafting and return the title, the body and the
exact commands.

## Steps

1. Run these checks:
   - `gh auth status`. If gh is not authenticated, stop.
   - The base is `$ARGUMENTS` if given, otherwise
     `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`.
   - If the current branch is the base, stop and propose a `feature/…` branch name.
   - `git status`: if there are uncommitted changes, stop and report them. Commit them first
     with the `commit` skill, or confirm they are meant to stay out of the PR.
   - `gh pr view --json url` succeeds: a PR already exists. Show its URL and stop.
2. Read the whole branch, not just the last commit:
   - `git fetch origin <base>`
   - `git log origin/<base>..HEAD --format='%h %s%n%b'`
   - `git diff origin/<base>...HEAD --stat`, plus the full diff where you need detail
3. Draft the title: a Conventional Commits summary under 70 characters, for example
   `feat: add order creation tests`. It becomes the commit message on the default branch after a
   squash merge, so it must follow the convention.
4. Draft the body with exactly these sections:
   ```
   ## Summary
   A concise description of the change.

   ## Why
   Why the change exists and what problem it solves.

   ## Changes
   The important implementation changes.

   ## Architecture
   Relevant architectural decisions.

   ## Testing
   Exactly which tests and checks were run.

   ## Validation
   How the functionality was manually verified, if applicable.

   ## Known limitations
   Anything intentionally not implemented.

   ## Revision
   Revision number and name (for example `REV-012-short-name`), if one was supplied.
   ```
   - Summary and Changes come from the commits and diff.
   - Why, Architecture, Testing, Validation and Known limitations come from the delegation
     prompt. If one was not supplied, write "Not provided." Never invent test results, and never
     claim a test ran unless the prompt or a command you ran shows it.
   - Revision: give the number and name only. Revision documents may be local-only, so do not
     link to them. Omit the section if no revision was supplied.
   - End the body with the session's PR attribution line if one is supplied.
5. Quality bar: the PR must be understandable without reading every line of the diff. It should
   answer what changed, why, how, which architectural decisions were made, how it was tested, and
   what was left for later. Avoid generic statements such as "Implemented feature."; be specific
   ("Added tests for order creation covering the payment call, stock and price validation, and the
   confirmation email, with the payment provider and mail mocked").
6. Show the title and body, and say whether a push is needed. Ask for confirmation (see above).
7. If the work depends on an unmerged branch (avoid this), create the PR with
   `--base <parent-branch>` and say so at the top of the description. The `merge` skill covers
   how stacked PRs are merged.
8. After confirmation or authorization:
   - If there is no upstream or the branch is ahead, run `git push -u origin HEAD`.
     Never force-push.
   - Create the PR with a heredoc:
     ```
     gh pr create --base <base> --title "<title>" --body "$(cat <<'EOF'
     ...
     EOF
     )"
     ```
9. Return the PR number and URL.
