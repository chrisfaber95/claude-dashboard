---
name: resolve-conflicts
description: "Procedure for resolving Git merge, rebase or cherry-pick conflicts by understanding the intent of both sides. Applies when git reports CONFLICT, when files contain <<<<<<< markers, or when a merge or rebase is stopped. Followed by the git-workflow-manager agent; in a main session, delegate conflict resolution to that agent."
allowed-tools: [Bash, Read, Edit, Grep, Glob]
---

Resolve the current Git conflicts without losing either side's intent.

Wherever a step says to ask the user: in a main session, ask. When running as the
git-workflow-manager subagent, stop and return the question to the caller. Continue the
merge or rebase only if the delegation prompt authorized "continue".

## Steps

1. Work out what operation is in progress:
   - `.git/rebase-merge` or `.git/rebase-apply` exists: a rebase.
   - `.git/MERGE_HEAD` exists: a merge.
   - `.git/CHERRY_PICK_HEAD` exists: a cherry-pick.
   - None of these: look for stray `<<<<<<<` markers.
   During a rebase, "ours" is the branch being rebased onto and "theirs" is the commit being
   replayed. Keep that straight.
2. List the conflicted files with `git diff --name-only --diff-filter=U`.
3. For each file:
   - Read the whole file, not just the hunks.
   - Find each side's intent with `git log --oneline -5 <side> -- <file>`, plus `git show` for the
     relevant commits. During a merge, `git log --merge -p -- <file>` helps.
   - Resolve the file by combining both changes when they are compatible. When they truly
     conflict, keep the newer intent and note what was dropped.
   - Remove every marker (`<<<<<<<`, `=======`, `>>>>>>>`, `|||||||`), then confirm with
     `grep -n '^[<=>|]\{7\}' <file>`.
   - For lockfiles (`package-lock.json`, `yarn.lock`, `poetry.lock`, and similar), take one side
     and regenerate the file with the package manager. Do not hand-merge them.
4. If the conflict is ambiguous (business logic where both sides made deliberate, incompatible
   choices), stop and ask the user. Show both versions and your suggested resolution.
5. Run the project's tests or build if they are quick and obvious (for example `npm test`,
   `pytest`, `cargo check`). Fix anything the resolution broke.
6. Stage each resolved file with `git add <file>`. Then continue only if the user started the
   operation in this session or asked you to finish it:
   `git rebase --continue`, `git merge --continue` or `git cherry-pick --continue`.
   Otherwise, tell the user it is ready to continue.
7. Report each file, how it was resolved, and anything that was dropped.

Never run `git checkout --ours/--theirs .` on the whole tree, `git reset --hard`, or
`git rebase --skip` without asking. Offer `--abort` as an option when you are stuck; never run it
silently.
