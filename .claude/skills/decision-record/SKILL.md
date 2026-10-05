---
name: decision-record
description: "Procedure for writing an architecture decision record (ADR): context, options with trade-offs, the decision, and consequences, saved in the project's existing decisions folder with the next sequential number. Followed by the architect-reviewer agent; in a main session, delegate ADR writing to that agent."
argument-hint: "<decision to record>"
allowed-tools: [Read, Glob, Grep, Write]
---

Write a decision record for: $ARGUMENTS

Wherever a step says to ask the user: in a main session, ask. When running as the
architect-reviewer subagent, state the assumption and return the question. Record a decision the
request describes; do not make the decision yourself. If the decision is not stated, return the
options and a recommendation instead of writing a record.

## Steps

1. Find where the project keeps decisions: `docs/adr/`, `docs/decisions/`, `adr/`, or a section
   of `ARCHITECTURE.md`. Match its format and numbering. If there is none, propose
   `docs/adr/0001-<short-title>.md` and say you are starting the convention.
2. Use the next sequential number and a short kebab-case title. Never reuse or skip a number,
   and never edit an accepted record; supersede it with a new one that links back.
3. Gather the facts from the repo and the request: the problem, the constraints, what was
   considered, what was chosen, and why. Mark anything you inferred as an assumption.
4. Write the record, short and specific:
   ```
   # <number>. <Title>

   Status: proposed | accepted | superseded by <number>
   Date: <YYYY-MM-DD>

   ## Context
   The problem and the forces: requirements, constraints, numbers.

   ## Options considered
   1. <Option>: what it is, pros, cons.
   2. <Option>: what it is, pros, cons.

   ## Decision
   What we chose, in one or two sentences, and the main reason.

   ## Consequences
   What gets easier, what gets harder, what we must do next, and what would make us revisit.
   ```
5. State the rejected options honestly with their real advantages. A record that only argues for
   the winner is not useful later.
6. If the decision changes the architecture, say which architecture document needs updating
   (for example `ARCHITECTURE.md`). Update it only if the request asks.
7. Report the file path, the status you gave it, and any open question.
