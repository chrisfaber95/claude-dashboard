# Vendored skills

Community Vue 3 skills copied unchanged into `.claude/skills/`, so work on `.vue` files follows
documented Vue practice.

- **Source:** https://github.com/vuejs-ai/skills (MIT)
- **Commit:** `c9d355ff23f654309dd02006be671859df0a134c`
- **License:** `.claude/skills/LICENSE-vuejs-ai-skills` (the source repo's `LICENSE`)

| Folder in `.claude/skills/` | Use it for |
| --- | --- |
| `vue-best-practices` | any `.vue` or Vue work |
| `vue-testing-best-practices` | component tests |
| `vue-debug-guides` | Vue runtime warnings and errors |
| `create-adaptable-composable` | composables that accept maybe-reactive inputs |

Not vendored on purpose: the Options API, JSX, Pinia and Router skills of that repo (we use
`<script setup>`, our own typed store and no router).

## Rules

- Never edit the vendored files. Where they disagree with decision 0007, `docs/code-style.md` or
  `CLAUDE.md`, those win; write the difference down in `CLAUDE.md`, not in the skill.

## Updating

1. Clone the source into a temporary directory outside the repo:
   `git clone https://github.com/vuejs-ai/skills <tmp-dir>` and
   `git -C <tmp-dir> checkout <new-commit>`.
2. Replace the four folders in `.claude/skills/` with `<tmp-dir>/skills/<folder>` (all files,
   including `references/` and `reference/`), and `LICENSE-vuejs-ai-skills` with `<tmp-dir>/LICENSE`.
   Don't run anything from the clone.
3. Verify with `git diff --no-index <tmp-dir>/skills/<folder> .claude/skills/<folder>` (no output
   means identical).
4. Change the commit hash in this file.
