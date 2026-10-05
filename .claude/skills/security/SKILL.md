---
name: security
description: "Procedure for a security-focused code review: injection, authentication and authorization (including object-level access), secrets, XSS and CSRF, SSRF, path traversal, unsafe deserialization, cryptography, sensitive data in logs, dependency risk and file uploads, with exploitability and fixes. Read-only static review. Followed by the code-reviewer agent; in a main session, delegate security reviews to that agent."
argument-hint: "<code, change or area to review for security>"
allowed-tools: [Read, Glob, Grep, Bash]
---

Security review: $ARGUMENTS

Wherever a step says to ask the user: in a main session, ask. When running as the code-reviewer
subagent, state the assumption and return the question. This is a static, read-only review of
code you were asked to review. Do not attack running systems, do not send requests to live
services, and do not edit files.

## Steps

1. Map the trust boundaries in the code under review: where untrusted data enters (request
   bodies, query strings, headers, cookies, uploaded files, webhooks, environment, third-party
   responses), where it is used, and where it leaves (responses, logs, queries, commands, file
   system, other services). Follow each input to every place it ends up.
2. Injection: SQL built by string concatenation or template (use parameters), NoSQL operators
   from user objects, shell commands with `exec`, `system` or `shell: true` (use argument
   arrays), template injection, and header or log injection through line breaks. Check ORMs'
   raw query escape hatches.
3. Authentication: how identity is established, password storage (a slow hash such as argon2 or
   bcrypt, never plain or fast hashes), session and token handling (expiry, rotation, secure
   cookie flags, signature verification, algorithm pinning for JWTs), login and reset flows
   (rate limiting, no user enumeration, single-use expiring tokens).
4. Authorization: every route and use case checks the caller may do this action on this specific
   object (look for insecure direct object references: a user changing an id to read another
   user's order), admin-only actions enforced on the server, and the client never trusted for
   roles, prices or ownership. Check that new endpoints are not accidentally public.
5. Secrets and configuration: no keys, tokens or passwords in code, history of the diff,
   examples or logs; secrets from the environment; debug modes and verbose errors off in
   production; permissive CORS (`*` with credentials), missing security headers, and insecure
   defaults.
6. Web issues: output encoding and `innerHTML`, `dangerouslySetInnerHTML` or `v-html` with
   untrusted data (XSS), state-changing requests without CSRF protection when cookies are used,
   open redirects, and clickjacking exposure.
7. Server-side request forgery and files: fetching user-supplied URLs (restrict hosts and
   schemes, block internal addresses), path traversal in file reads and writes (normalize and
   confirm the path stays inside the intended directory), uploads (type, size and name checks,
   storage outside the web root, no execution), and zip extraction.
8. Data handling: unsafe deserialization of untrusted input, mass assignment (binding request
   bodies directly to models), weak randomness for tokens (use a cryptographic source), broken
   crypto (home-made schemes, ECB mode, static IVs, MD5 or SHA-1 for security), timing-unsafe
   secret comparison, and personal or payment data written to logs or returned in responses.
9. Dependencies: note new or risky packages and point to an audit if one is warranted; do not
   run installs. Run the package manager's audit only if it is read-only and local.
10. Rank by exploitability and impact: **blocker** (remote exploitation, auth bypass, data
    exposure), **major** (needs preconditions or limited impact), **minor** (hardening). Each
    finding has file and line, the attack scenario in plain steps, the impact, and a concrete
    fix. Never include a real secret in the report; name its location and type.
11. State what you reviewed and what you did not (for example, infrastructure, running
    configuration, third-party services), since a static review cannot prove the absence of
    vulnerabilities.
