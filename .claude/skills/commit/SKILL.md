---
name: commit
description: "Procedure for committing and pushing: focused Conventional Commits commit, specific files staged, secret check, hooks never skipped, then (only if authorized) a verified push. Followed by the git-workflow-manager agent; in a main session, delegate commits to that agent rather than running this directly."
argument-hint: "[optional message hint, files, or revision id]"
allowed-tools: [Bash, Read, Grep]
---

Create one focused commit for the current changes, and push it only if the request includes
pushing. User hint (may be empty): $ARGUMENTS

Wherever a step says to ask the user: in a main session, ask. When running as the
git-workflow-manager subagent, stop and return the proposal to the caller.

## Commit

1. Run `git status` (never with `-uall`), `git diff`, `git diff --staged` and `git log --oneline -10`.
   If nothing has changed, say so and stop. Do not create an empty commit.
2. Keep the commit focused. Include only changes that belong together; no unrelated edits. If the
   changes are unrelated to each other, propose splitting them and ask which group goes first.
3. Stage files by name: `git add path/a path/b`. Avoid `git add -A` or `git add .`. If you do use
   one, run `git status` afterwards and unstage anything unexpected.
4. Secret check: do not stage `.env*`, `*.pem`, `*.key`, `credentials*`, or `*secret*` files.
   Grep the staged diff for tokens and keys (`AKIA`, `ghp_`, `gho_`, `sk-`, `-----BEGIN`,
   `password=`). If anything matches, stop and show the user.
5. Write the message in Conventional Commits format:
   - `type(scope)!: summary`, where type is one of feat, fix, docs, style, refactor, perf, test,
     build, ci, chore, revert. The scope is optional, and `!` marks a breaking change.
   - A message must describe the change: `feat(orders): add order creation tests`, never
     `stuff` or `changes`.
   - If a revision id was supplied, it may be the scope: `feat(rev-12): add order tests`.
   - Write the summary in the imperative, lower case, under 72 characters, with no trailing period.
   - Add a body only when the reason for the change is not obvious. For a breaking change, add a
     `BREAKING CHANGE: …` footer.
   - End with the Co-Authored-By trailer if the session supplies one.
6. Commit with a heredoc so the formatting survives:
   ```
   git commit -m "$(cat <<'EOF'
   feat(skills): add release skill

   Co-Authored-By: …
   EOF
   )"
   ```
7. Never pass `--no-verify`, `--no-gpg-sign` or `--amend`. If a hook fails, the commit did not
   happen. Fix the cause, re-stage, and make a new commit.
8. Run `git status` and show the commit with `git log --oneline -1`.

## Push (only if the request includes pushing)

9. Verify before pushing:
   - `git remote -v` shows the expected remote (normally `origin`, the project's GitHub repo).
   - `git branch --show-current` is the branch the request named. Never push `main` directly
     unless the request says so explicitly.
   - `git log origin/<base>..HEAD --oneline` (base is usually `main`) lists only the commits
     intended for this change.
   If any check fails, stop and report it.
10. Push: `git push`, or `git push -u origin HEAD` for a new branch. Never force-push.
11. Confirm with `git status -sb` that the branch is in sync with its remote.
