---
name: merge
description: "Procedure for verifying CI, merging a GitHub pull request, and cleaning up afterwards: gh pr checks, merge gates, squash merge, merged-branch deletion with a tip check, local main update. Followed by the git-workflow-manager agent; merge is authorized by default once every gate passes, unless the delegation restricts it or the project sets merge_mode: ask."
argument-hint: "<PR number or URL>"
allowed-tools: [Bash, Read, Grep]
---

Verify CI for a pull request, merge it if every gate passes, and clean up. PR: $ARGUMENTS
(if empty, use the PR of the current branch).

Never use `gh pr merge --admin`, and never bypass failed checks, branch protection or required
reviews just to get a PR merged. In a main session, ask the user before merging. When running as
the git-workflow-manager subagent, merging is authorized by default once every gate passes,
unless the delegation prompt restricts it ("don't merge") or the project parameters set
`merge_mode: ask`, in which case merge only if the prompt says "merge". Delete branches only as
part of that merge or when "cleanup" is authorized. Otherwise stop after the gate report.

Read the project parameters first: the `git` section of `.claude/project-params.md`, or a root
`WORKFLOW.md` if that file does not exist. They may add merge gates, required local documents
and after-merge checks. Treat those as extra gates alongside the ones below.

## 1. CI verification

1. Wait for checks to finish: `gh pr checks <PR> --watch`. Do not assume a local test run means
   CI passed.
2. Immediately before merging, re-check: `gh pr checks <PR> --json name,bucket`. Only `bucket`
   `pass` counts. `pending`, `skipping`, `fail`, `cancel`, or no checks reported at all counts as
   not passed. The exception is a repo whose project parameters state it has no CI.
3. If branch protection is absent, GitHub will not block a bad merge for you. These gates are
   then the only protection, so apply them strictly. Check with
   `gh api repos/{owner}/{repo}/branches/<base>/protection` (404 means none).

## 2. Merge gates

All of these must hold. If any fails, stop and return the failing gate with the evidence.

- Every check has bucket `pass` (step 1).
- `gh pr view <PR> --json mergeable,mergeStateStatus,reviewDecision,state,headRefOid` shows
  `state` OPEN, `mergeable` MERGEABLE (no conflicts), and `mergeStateStatus` CLEAN (or HAS_HOOKS).
  `BLOCKED`, `BEHIND`, `DIRTY` or `UNKNOWN` mean stop. Re-query once if `UNKNOWN`.
- `reviewDecision` is not `CHANGES_REQUESTED` or `REVIEW_REQUIRED`.
- The PR description is complete (all sections from the `pr` skill present, none left blank).
- Any extra gates from the project parameters hold (for example, required local documents exist).
- The work the PR represents is finished. If the delegation prompt says it is not, stop.

## 3. Merge

1. For a normal PR, if the branch exists locally, verify its local tip matches the PR head before
   deleting anything: `git rev-parse <branch>` equals `headRefOid` from the query above, and
   `git rev-parse origin/<branch>` equals it too. `--delete-branch` removes the local branch as
   well, so unpushed local commits would be lost. If the tips differ, merge without
   `--delete-branch` and report the mismatch.
2. Merge, preferring squash unless the repo says otherwise:
   `gh pr merge <PR> --squash --delete-branch --match-head-commit <headRefOid>`
   (`--match-head-commit` makes the merge fail if someone pushed after you checked.)
3. Never delete `main`, the default branch, an unmerged branch, or a branch with unpushed
   commits. Only `feature/*` branches whose PR is merged are eligible.

### Stacked PRs

Avoid them. If a PR targets another unmerged branch (`baseRefName` is not the default branch):

- Merge the parent first, without `--delete-branch` while a child still targets it.
- Then the child needs `gh pr edit <child> --base <default>` and a rebase onto the new default
  branch with `git rebase --onto origin/<default> <old-parent-tip> <child-branch>` (a plain
  rebase replays the parent's commits after a squash merge and conflicts), followed by a force
  push and a fresh CI run. The agent never force-pushes, so return these steps as a proposal.
- Never merge a child into its parent branch and call that "merged".

## 4. After merge

1. Verify the merge: `gh pr view <PR> --json state,mergeCommit` shows `MERGED`, and
   `git fetch origin` then `git log origin/<default> --oneline -3` shows the squash commit.
2. Update local: `git checkout <default>`, then `git pull --ff-only`. If the pull cannot
   fast-forward, stop and report; do not reset.
3. Remove leftovers only for the merged `feature/*` branch: if `gh` did not already delete the
   local branch, and its tip matched `headRefOid` in 3.1, run `git branch -D <branch>`
   (`-d` cannot see a squash-merged branch as merged, so the tip check above is what makes `-D`
   safe). Then `git fetch --prune`.
4. Run any after-merge verifications listed in the project parameters.
5. Start the next piece of work from this updated default branch, never from an outdated one.

## Report

Return, briefly: CI status (per failing or pending check if any), PR number and URL, merge
status (merged or the blocking gate), branches deleted, and any limitations or follow-ups.
The summary of what was implemented, and asking the user whether to continue, belong to the
main session.
