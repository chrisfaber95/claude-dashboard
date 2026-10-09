import { updateSummaryNote } from './settings.ts';
import type { CommandResult, DashboardState, TranscriptEntry, TranscriptPage } from '../shared/types.ts';
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

function openDrawer(title: string, sub: string, mode: DrawerMode) {
  drawer = mode;
  entries = [];
  hasMore = false;
  truncated = false;
  window.clearInterval(timer);
  $('drawer-title').textContent = title;
  $('drawer-sub').textContent = sub;
  $('drawer-body').innerHTML = '<div class="empty">Loading…</div>';
  $('drawer-form').hidden = !(commandsOn && mode.kind === 'transcript');
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

// ---- recent tasks (started from the run panel, kept in localStorage) ----

interface RecentTask {
  id: string;
  project: string;
  prompt: string;
  startedAt: number;
}

const RECENT_KEY = 'recentTasks';
const RECENT_MAX = 10;
const PROMPT_MAX = 80;
let latest: DashboardState | null = null;
let recent: RecentTask[] = [];

function isRecentTask(v: unknown): v is RecentTask {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.project === 'string' && typeof o.prompt === 'string' && typeof o.startedAt === 'number' && Number.isFinite(o.startedAt);
}

function loadRecent(): RecentTask[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isRecentTask)
      .filter((t) => t.id === '' || /^[A-Za-z0-9_-]{4,64}$/.test(t.id))
      .map((t) => ({ id: t.id.slice(0, 64), project: t.project.slice(0, 200), prompt: t.prompt.slice(0, PROMPT_MAX), startedAt: t.startedAt }))
      .slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

function saveRecent() {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch {
    // storage unavailable: the list just lasts until reload
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

function renderRecent() {
  $('recent').hidden = recent.length === 0;
  $('recent-list').innerHTML = recent
    .map(
      (t, i) => `<li class="recent__item" data-ri="${i}">
        <span class="recent__dot" aria-hidden="true"></span>
        <span class="recent__main"><span class="recent__project">${esc(t.project)}</span>
          <span class="recent__prompt">${esc(t.prompt)}</span>
          <span class="sub"><span class="recent__time">${esc(ago(t.startedAt))}</span> · <span class="recent__state"></span></span></span>
        ${t.id ? `<button class="btn btn--sm" type="button" data-recent="${esc(t.id)}" data-name="${esc(t.project)}">View</button>` : ''}
      </li>`,
    )
    .join('');
  patchRecent();
}

/** Updates live dots and times in place; the list itself is not rebuilt on state pushes. */
function patchRecent() {
  document.querySelectorAll<HTMLElement>('#recent-list .recent__item').forEach((li) => {
    const t = recent[Number(li.dataset.ri)];
    if (!t) return;
    const live = Boolean(t.id && latest && matchSession(latest.sessions, t.id));
    li.classList.toggle('is-live', live);
    li.querySelector('.recent__state')!.textContent = !t.id ? 'no id to link' : live ? 'live' : 'not live';
    li.querySelector('.recent__time')!.textContent = ago(t.startedAt);
  });
}

function addRecent(id: string | undefined, project: string, prompt: string) {
  recent = [{ id: id ?? '', project, prompt: prompt.trim().slice(0, PROMPT_MAX), startedAt: Date.now() }, ...recent].slice(0, RECENT_MAX);
  saveRecent();
  renderRecent();
}

// ---- wiring ----

export function initControls() {
  recent = loadRecent();
  renderRecent();
  $('recent-clear').addEventListener('click', () => {
    recent = [];
    saveRecent();
    renderRecent();
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
    const project = $<HTMLSelectElement>('run-project').value;
    const permissionMode = $<HTMLSelectElement>('run-mode').value;
    const prompt = $<HTMLTextAreaElement>('run-prompt').value;
    if (!confirm(`Start a background Claude session in ${project} (${permissionMode} mode)?`)) return;
    const status = $('run-status');
    status.textContent = 'Starting…';
    try {
      const r = await api<CommandResult>('/api/commands', { project, prompt, permissionMode });
      status.textContent = describe(r);
      if (r.ok) {
        addRecent(r.id, project, prompt);
        $<HTMLTextAreaElement>('run-prompt').value = '';
      }
    } catch (err) {
      status.textContent = (err as Error).message;
    }
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
  patchRecent();
  commandsOn = s.features.commands;
  updateSummaryNote(commandsOn);
  $('run').hidden = !commandsOn;
  $('logout').hidden = !s.features.lan;
  if (drawer?.kind === 'transcript') $('drawer-form').hidden = !commandsOn;

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
