# Claude Dashboard

Web dashboard for Claude Code activity: projects, live sessions and transcripts, messages between sessions, token usage
and subscription limits. See `CLAUDE.md` for commands and rules, and `docs/architecture.md` for the layout.

## Search panel

When `DASHBOARD_SEARCH_URL` points at the homelab search service (tailnet only), a **Search** button appears in the
popup bar. Type a question, optionally tick *Hard question* (the service uses the claude tier), pick a project or source
type, and get a cited answer plus the matching sources (source, location, date, project). The thumbs-down button
reports a bad answer to the service.

```
DASHBOARD_SEARCH_URL=http://<tailnet-host>:<port> npm start
DASHBOARD_SEARCH_TOKEN=...   # optional, if the service wants a bearer token
```

The panel sits behind the dashboard login, only calls query, ask and feedback, and the browser never sees the service
address or token. If the service is down the panel shows an error instead of an answer. Without the variable the panel
is hidden. API details: "Search" in `docs/architecture.md`.
