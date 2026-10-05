---
name: review-design
description: "Procedure for reviewing a software design: goals and constraints, component boundaries, coupling, data ownership, failure modes, scalability against stated numbers, security boundaries, operability and technology fit, ending in evidenced findings and a recommendation. Followed by the architect-reviewer agent; in a main session, delegate design reviews to that agent."
argument-hint: "<design, change, or area to review>"
allowed-tools: [Read, Glob, Grep, Bash]
---

Review the design of: $ARGUMENTS

Wherever a step says to ask the user: in a main session, ask. When running as the
architect-reviewer subagent, state the assumption and return the question. This review is
read-only: do not change code.

## Steps

1. State the goal and the constraints in your own words: what the system must do, for whom, and
   the hard limits (data volume, users, latency, budget, team size, deadlines, existing stack).
   Use the numbers from the project's docs. If there are none, say "no stated targets" rather
   than inventing them.
2. Map what exists: the components, what each owns, how they talk (calls, queues, shared
   database), and where data enters and leaves. Verify against the code, not only the docs.
   Write the map as a short list or a Mermaid diagram.
3. Check the boundaries and layering the project defines (for example UI, routes, use-case
   logic, persistence, external services). Look for leaks: database access in UI code,
   business rules in route handlers, secrets or third-party calls on the wrong side of a trust
   boundary, one module reaching into another's internals.
4. Check coupling and cohesion: modules that must change together, circular dependencies,
   shared mutable state, a single component that knows everything. A boundary is worth keeping
   only if it gives a concrete benefit; flag abstraction that has no second user.
5. Check data: who owns each piece of data, where the source of truth is, how it is kept
   consistent, what happens on partial failure (a payment succeeds but the order write fails),
   and what migrations or backfills the change implies.
6. Check scalability against the stated numbers only: what the expensive operations are (full
   loads, N+1 queries, work in the request path that could be deferred), what grows with data,
   and what the first bottleneck will be. Do not invent a scale the project does not have.
7. Check failure and operability: timeouts, retries and idempotency on external calls, what
   happens when a dependency is down, logging and the ability to diagnose problems, how it is
   configured and deployed, how to roll back.
8. Check security at the design level: trust boundaries, authentication and authorization
   placement, handling of secrets and personal data, and exposure of internals.
9. Check technology fit: does each choice solve a problem the project has, is it mature and
   maintained, does it match the team's skills, and what is the cost of changing it later.
   Prefer what the project already uses unless there is a concrete reason.
10. Write the result: a verdict, then findings ranked blocker, risk, improvement. Each has
    evidence (file and line, or a quoted project rule), the impact, and a suggested direction.
    For any real choice, give two or three options with trade-offs and your recommendation.
    Say what you could not verify and what you assumed.
