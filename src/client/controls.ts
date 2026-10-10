import { updateSummaryNote } from './settings.ts';
import type { AuditEntry, CommandResult, DashboardState, TranscriptEntry, TranscriptPage } from '../shared/types/index.ts';
import { launchBody, fieldsAfterLaunch, launchRow, launchState } from './launch-logic.ts';
import { patchHtml } from './patch.ts';
import { $, ago, api, esc } from './util.ts';

const ROLE_LABEL: Record<TranscriptEntry['role'], string> = {
  user: 'You',
  assistant: 'Claude',
  tool: 'Tool call',
  result: 'Tool result',
  peer: 'Message',
};

let commandsOn = false;
let projectKey = '';
let modesFilled = false;

// ---- drawer (transcript / logs) ----

type DrawerMode = { kind: 'transcript'; id: string } | { kind: 'subagent'; id: string } | { kind: 'logs'; id: string };
let drawer: DrawerMode | null = null;

/** Drawer modes that show a transcript (a session's or a subagent's), as opposed to terminal logs. */
const showsTranscript = (d: DrawerMode | null): d is Extract<DrawerMode, { kind: 'transcript' | 'subagent' }> => d?.kind === 'transcript' || d?.kind === 'subagent';

const transcriptPath = (d: Extract<DrawerMode, { kind: 'transcript' | 'subagent' }>, query: string) =>
  `/api/${d.kind === 'subagent' ? 'subagents' : 'sessions'}/${encodeURIComponent(d.id)}/transcript?${query}`;

// A subagent's transcript starts with the brief its caller handed down and ends with its report.
const SUBAGENT_LABEL: Partial<Record<TranscriptEntry['role'], string>> = { user: 'Brief from caller', assistant: 'Subagent' };
let entries: TranscriptEntry[] = [];
let hasMore = false;
let truncated = false;
let timer: number | undefined;

function entryHtml(e: TranscriptEntry): string {
  const who = e.role === 'peer' && e.from ? `Message from ${e.from}` : ((drawer?.kind === 'subagent' && SUBAGENT_LABEL[e.role]) || ROLE_LABEL[e.role]);
  return `<div class="msg msg--${e.role}${e.isError ? ' msg--error' : ''}">
    <div class="msg__meta">${esc(who)}${e.tsMs ? ` · ${esc(new Date(e.tsMs).toLocaleTimeString())}` : ''}</div>
    <div class="msg__text">${esc(e.text)}</div></div>`;
}

function renderEntries(keepBottom: boolean) {
  const body = $('drawer-body');
  const more = hasMore
    ? '<button class="btn btn--sm" data-more type="button">Load earlier</button>'
    : truncated
      ? '<div class="sub">Older history isn\x27t shown (very large transcript).</div>'
      : '';
  body.innerHTML = more + (entries.length ? entries.map(entryHtml).join('') : '<div class="empty">No messages yet.</div>');
  if (keepBottom) body.scrollTop = body.scrollHeight;
}

async function refreshTranscript(initial: boolean) {
  if (!showsTranscript(drawer)) return;
  const id = drawer.id;
  const body = $('drawer-body');
  const atBottom = initial || body.scrollHeight - body.scrollTop - body.clientHeight < 40;
  try {
    const page = await api<TranscriptPage>(transcriptPath(drawer, 'limit=100'));
    if (!showsTranscript(drawer) || drawer.id !== id) return;
    // Keep earlier pages the user loaded; replace only the live tail.
    const firstNew = page.entries[0]?.uuid;
    const keep = firstNew ? entries.slice(0, Math.max(0, entries.findIndex((e) => e.uuid === firstNew))) : [];
    const prevLen = entries.length;
    entries = [...keep, ...page.entries];
    if (!keep.length) {
      hasMore = page.hasMore;
      truncated = Boolean(page.truncated);
    }
    if (initial || entries.length !== prevLen) renderEntries(atBottom);
  } catch (e) {
    if (initial) body.innerHTML = `<div class="empty">${esc((e as Error).message)}</div>`;
  }
}

async function loadEarlier() {
  if (!showsTranscript(drawer) || !entries.length) return;
  const page = await api<TranscriptPage>(transcriptPath(drawer, `limit=100&before=${encodeURIComponent(entries[0].uuid)}`));
  const body = $('drawer-body');
  const fromBottom = body.scrollHeight - body.scrollTop;
  entries = [...page.entries, ...entries];
  hasMore = page.hasMore;
  truncated = Boolean(page.truncated);
  renderEntries(false);
  body.scrollTop = body.scrollHeight - fromBottom;
}

/** Shows the follow-up form, or a note when the session is live in a terminal/editor (server refuses those with 409). Only toggles `hidden`. */
function syncDrawerForm() {
  const transcript = drawer?.kind === 'transcript' && commandsOn;
  const id = drawer?.kind === 'transcript' ? drawer.id : '';
  const liveElsewhere = transcript && Boolean(latest?.sessions.some((s) => s.sessionId === id && s.kind !== 'bg'));
  $('drawer-form').hidden = !transcript || liveElsewhere;
  $('drawer-live-note').hidden = !liveElsewhere;
}

function openDrawer(title: string, sub: string, mode: DrawerMode) {
  drawer = mode;
  entries = [];
  hasMore = false;
  truncated = false;
  window.clearInterval(timer);
  $('drawer-title').textContent = title;
  $('drawer-sub').textContent = sub;
  $('drawer-body').innerHTML = '<div class="empty">Loading…</div>';
  syncDrawerForm();
  $('drawer-status').textContent = '';
  $('drawer').hidden = false;
}

export function openTranscript(id: string, name: string) {
  openDrawer(name, `Session ${id}`, { kind: 'transcript', id });
  void refreshTranscript(true);
  timer = window.setInterval(() => void refreshTranscript(false), 2000);
}

/** Read-only view of what a subagent was told and what it did. */
export function openSubagentTranscript(id: string, name: string) {
  openDrawer(name, `Subagent ${id}`, { kind: 'subagent', id });
  void refreshTranscript(true);
  timer = window.setInterval(() => void refreshTranscript(false), 2000);
}

async function openLogs(id: string, name: string) {
  openDrawer(`${name} logs`, `Recent terminal output of ${id}`, { kind: 'logs', id });
  try {
    const r = await api<CommandResult>(`/api/sessions/${encodeURIComponent(id)}/logs`);
    $('drawer-body').innerHTML = `<pre class="logs">${esc(r.output || '(no output)')}</pre>`;
  } catch (e) {
    $('drawer-body').innerHTML = `<div class="empty">${esc((e as Error).message)}</div>`;
  }
}

function closeDrawer() {
  drawer = null;
  window.clearInterval(timer);
  $('drawer').hidden = true;
}

// ---- toasts ----

function toast(text: string, isError = false) {
  const t = document.createElement('div');
  t.className = `toast${isError ? ' toast--error' : ''}`;
  t.setAttribute('role', 'status');
  t.textContent = text;
  document.body.append(t);
  window.setTimeout(() => t.remove(), 6000);
}

function describe(r: CommandResult): string {
  if (r.needsTrust) return `Folder not trusted yet. ${r.needsTrust}`;
  return r.ok ? `Started${r.id ? ` (${r.id})` : ''}. ${r.output}`.trim() : r.output || 'Command failed.';
}

// ---- recent launches (server-side history from GET /api/launches, the same on every device) ----

let latest: DashboardState | null = null;
let launches: AuditEntry[] = [];

async function loadLaunches() {
  try {
    launches = (await api<{ launches: AuditEntry[] }>('/api/launches')).launches;
    renderLaunches();
  } catch {
    // keep the list we have; the next load retries
  }
}

/** Full session id for a short background id, from the latest state; null when not known yet. */
function resolveSession(shortId: string): { id: string; name: string; live: boolean } | null {
  if (!latest || shortId.length < 4) return null;
  const live = matchSession(latest.sessions, shortId);
  if (live) return { id: live.sessionId, name: live.name || live.sessionId, live: true };
  const old = matchSession(latest.recentSessions, shortId);
  return old ? { id: old.sessionId, name: old.sessionId, live: old.live } : null;
}

/** Exact id first, then a prefix match only when it is unambiguous. */
function matchSession<T extends { sessionId: string }>(list: T[], id: string): T | undefined {
  if (id.length < 4) return undefined;
  const exact = list.find((x) => x.sessionId === id);
  if (exact) return exact;
  const prefixed = list.filter((x) => x.sessionId.startsWith(id));
  return prefixed.length === 1 ? prefixed[0] : undefined;
}

/** Patches the launch list in place (running / not live and relative time); rows keep their nodes. */
function renderLaunches() {
  $('recent').hidden = launches.length === 0;
  const html = launches
    .map(launchRow)
    .map((row) => {
      const state = launchState(row, Boolean(row.session && latest && matchSession(latest.sessions, row.session)));
      return `<li class="recent__item${state === 'running' ? ' is-live' : ''}${state === 'failed' ? ' is-failed' : ''}" data-key="${esc(row.key)}">
        <span class="recent__dot" aria-hidden="true"></span>
        <span class="recent__main"><span class="recent__project">${esc(row.project)}</span>
          <span class="recent__prompt">${esc(row.goal)}</span>
          <span class="sub"><span class="recent__time">${esc(ago(row.tsMs))}</span> · ${esc(row.device)} · <span class="recent__state">${esc(state)}</span></span></span>
        ${row.session ? `<button class="btn btn--sm" type="button" data-recent="${esc(row.session)}" data-name="${esc(row.project)}">View</button>` : ''}
      </li>`;
    })
    .join('');
  patchHtml($('recent-list'), html);
}

// ---- wiring ----

export function initControls() {
  try {
    localStorage.removeItem('recentTasks'); // old per-browser history, replaced by the server-side launch history
  } catch {
    // storage unavailable
  }
  void loadLaunches();
  document.addEventListener('click', (e) => {
    if ((e.target as Element).closest('[data-popup="run"]')) void loadLaunches();
  });

  document.addEventListener('click', async (e) => {
    const rec = (e.target as Element).closest<HTMLElement>('[data-recent]');
    if (rec?.dataset.recent) {
      const found = resolveSession(rec.dataset.recent);
      if (found) openTranscript(found.id, found.live ? found.name : (rec.dataset.name ?? found.name));
      else toast('Session not found yet, try again in a moment');
      return;
    }
    const el = (e.target as Element).closest<HTMLElement>('[data-view],[data-logs],[data-stop],[data-more]');
    if (!el) return;
    if (el.dataset.more !== undefined) {
      await loadEarlier().catch((err) => toast((err as Error).message, true));
    } else if (el.dataset.view) {
      openTranscript(el.dataset.view, el.dataset.name ?? el.dataset.view);
    } else if (el.dataset.logs) {
      await openLogs(el.dataset.logs, el.dataset.name ?? el.dataset.logs);
    } else if (el.dataset.stop) {
      if (!confirm(`Stop background session ${el.dataset.name ?? el.dataset.stop}? Its conversation is kept.`)) return;
      try {
        const r = await api<CommandResult>(`/api/sessions/${encodeURIComponent(el.dataset.stop)}/stop`, {});
        toast(r.ok ? 'Stopped.' : r.output || 'Stop failed.', !r.ok);
      } catch (err) {
        toast((err as Error).message, true);
      }
    }
  });

  $('drawer-close').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer) closeDrawer();
  });

  $('run-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = $('run-status');
    const project = $<HTMLSelectElement>('run-project').value;
    const body = launchBody(project, $<HTMLTextAreaElement>('run-goal').value, $<HTMLTextAreaElement>('run-notes').value, $<HTMLSelectElement>('run-mode').value);
    // Empty goal or no project: skip the confirm, the server answers with its own message, shown below; nothing starts.
    if (body.goal && project && !confirm(`Launch a background Claude session in ${project} (${body.permissionMode} mode)?`)) return;
    status.textContent = 'Starting…';
    let ok = false;
    try {
      const r = await api<CommandResult>('/api/commands', body);
      ok = r.ok;
      status.textContent = describe(r);
    } catch (err) {
      status.textContent = (err as Error).message;
    }
    const clear = fieldsAfterLaunch(ok);
    if (clear.clearGoal) $<HTMLTextAreaElement>('run-goal').value = '';
    if (clear.clearNotes) $<HTMLTextAreaElement>('run-notes').value = '';
    if (ok) void loadLaunches();
  });

  $('drawer-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (drawer?.kind !== 'transcript') return;
    const prompt = $<HTMLTextAreaElement>('drawer-prompt').value;
    const permissionMode = $<HTMLSelectElement>('drawer-mode').value;
    const status = $('drawer-status');
    status.textContent = 'Sending…';
    try {
      const r = await api<CommandResult>(`/api/sessions/${encodeURIComponent(drawer.id)}/message`, { prompt, permissionMode });
      status.textContent = describe(r);
      if (r.ok) $<HTMLTextAreaElement>('drawer-prompt').value = '';
    } catch (err) {
      status.textContent = (err as Error).message;
    }
  });
}

/** Called on every state push. Never re-renders the forms, so typing isn't interrupted. */
export function updateControls(s: DashboardState) {
  latest = s;
  renderLaunches();
  commandsOn = s.features.commands;
  updateSummaryNote(commandsOn);
  $('run').hidden = !commandsOn;
  $('logout').hidden = !s.features.lan;
  syncDrawerForm();

  if (!modesFilled) {
    const opts = s.features.permissionModes.map((m) => `<option value="${esc(m)}"${m === 'auto' ? ' selected' : ''}>${esc(m)}</option>`).join('');
    $('run-mode').innerHTML = opts;
    $('drawer-mode').innerHTML = opts;
    modesFilled = true;
  }

  const key = s.projects.map((p) => `${p.name}:${p.trusted}`).join('|');
  if (key !== projectKey) {
    const sel = $<HTMLSelectElement>('run-project');
    const current = sel.value;
    sel.innerHTML = s.projects
      .map((p) => `<option value="${esc(p.name)}">${esc(p.name)}${p.trusted ? '' : ' (not trusted yet)'}</option>`)
      .join('');
    if (current && s.projects.some((p) => p.name === current)) sel.value = current;
    projectKey = key;
  }
}
