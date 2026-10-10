import type { CommandResult, DashboardState, TranscriptEntry, TranscriptPage } from '../../../shared/types/index.ts';
import { api } from '../../shared/api.ts';
import { elementById } from '../../shared/dom.ts';
import { esc } from '../../shared/escape.ts';
import { describeCommandResult, entrySpeaker, showsTranscript, transcriptPath } from './controls.logic.ts';
import type { DrawerMode } from './controls.logic.ts';

const POLL_INTERVAL_MS = 2000;
const NEAR_BOTTOM_PX = 40;
const PAGE_SIZE = 100;

let canRunCommands = false;
let latestState: DashboardState | null = null;
let drawerMode: DrawerMode | null = null;
let entries: TranscriptEntry[] = [];
let hasMore = false;
let isTruncated = false;
let pollTimer: number | undefined;

function entryHtml(entry: TranscriptEntry): string {
  const speaker = entrySpeaker(entry, drawerMode?.kind === 'subagent');
  return `<div class="msg msg--${entry.role}${entry.isError ? ' msg--error' : ''}">
    <div class="msg__meta">${esc(speaker)}${entry.tsMs ? ` · ${esc(new Date(entry.tsMs).toLocaleTimeString())}` : ''}</div>
    <div class="msg__text">${esc(entry.text)}</div></div>`;
}

function earlierHtml(): string {
  if (hasMore) return '<button class="btn btn--sm" data-more type="button">Load earlier</button>';
  if (isTruncated) return '<div class="sub">Older history isn\x27t shown (very large transcript).</div>';
  return '';
}

function renderEntries(shouldKeepBottom: boolean): void {
  const body = elementById('drawer-body');
  body.innerHTML = earlierHtml() + (entries.length ? entries.map(entryHtml).join('') : '<div class="empty">No messages yet.</div>');
  if (shouldKeepBottom) body.scrollTop = body.scrollHeight;
}

async function refreshTranscript(isInitial: boolean): Promise<void> {
  if (!showsTranscript(drawerMode)) return;
  const id = drawerMode.id;
  const body = elementById('drawer-body');
  const isAtBottom = isInitial || body.scrollHeight - body.scrollTop - body.clientHeight < NEAR_BOTTOM_PX;
  try {
    const page = await api<TranscriptPage>(transcriptPath(drawerMode, `limit=${PAGE_SIZE}`));
    if (!showsTranscript(drawerMode) || drawerMode.id !== id) return;
    // Keep earlier pages the user loaded; replace only the live tail.
    const firstNewUuid = page.entries[0]?.uuid;
    const keptEntries = firstNewUuid ? entries.slice(0, Math.max(0, entries.findIndex((entry) => entry.uuid === firstNewUuid))) : [];
    const previousLength = entries.length;
    entries = [...keptEntries, ...page.entries];
    if (!keptEntries.length) {
      hasMore = page.hasMore;
      isTruncated = Boolean(page.truncated);
    }
    if (isInitial || entries.length !== previousLength) renderEntries(isAtBottom);
  } catch (error) {
    if (isInitial) body.innerHTML = `<div class="empty">${esc((error as Error).message)}</div>`;
  }
}

/** Fetch the page of entries before the oldest one shown and keep the reader's scroll position. */
export async function loadEarlier(): Promise<void> {
  if (!showsTranscript(drawerMode) || !entries.length) return;
  const page = await api<TranscriptPage>(transcriptPath(drawerMode, `limit=${PAGE_SIZE}&before=${encodeURIComponent(entries[0].uuid)}`));
  const body = elementById('drawer-body');
  const distanceFromBottom = body.scrollHeight - body.scrollTop;
  entries = [...page.entries, ...entries];
  hasMore = page.hasMore;
  isTruncated = Boolean(page.truncated);
  renderEntries(false);
  body.scrollTop = body.scrollHeight - distanceFromBottom;
}

/** Shows the follow-up form, or a note when the session is live in a terminal/editor (server refuses those with 409). Only toggles `hidden`. */
function syncDrawerForm(): void {
  const isTranscript = drawerMode?.kind === 'transcript' && canRunCommands;
  const id = drawerMode?.kind === 'transcript' ? drawerMode.id : '';
  const isLiveElsewhere = isTranscript && Boolean(latestState?.sessions.some((session) => session.sessionId === id && session.kind !== 'bg'));
  elementById('drawer-form').hidden = !isTranscript || isLiveElsewhere;
  elementById('drawer-live-note').hidden = !isLiveElsewhere;
}

function openDrawer(title: string, subtitle: string, mode: DrawerMode): void {
  drawerMode = mode;
  entries = [];
  hasMore = false;
  isTruncated = false;
  window.clearInterval(pollTimer);
  elementById('drawer-title').textContent = title;
  elementById('drawer-sub').textContent = subtitle;
  elementById('drawer-body').innerHTML = '<div class="empty">Loading…</div>';
  syncDrawerForm();
  elementById('drawer-status').textContent = '';
  elementById('drawer').hidden = false;
}

function startPolling(): void {
  void refreshTranscript(true);
  pollTimer = window.setInterval(() => void refreshTranscript(false), POLL_INTERVAL_MS);
}

/** Open the drawer on a session's transcript and keep it current. */
export function openTranscript(id: string, name: string): void {
  openDrawer(name, `Session ${id}`, { kind: 'transcript', id });
  startPolling();
}

/** Read-only view of what a subagent was told and what it did. */
export function openSubagentTranscript(id: string, name: string): void {
  openDrawer(name, `Subagent ${id}`, { kind: 'subagent', id });
  startPolling();
}

/** Open the drawer on the recent terminal output of a background session. */
export async function openLogs(id: string, name: string): Promise<void> {
  openDrawer(`${name} logs`, `Recent terminal output of ${id}`, { kind: 'logs', id });
  try {
    const result = await api<CommandResult>(`/api/sessions/${encodeURIComponent(id)}/logs`);
    elementById('drawer-body').innerHTML = `<pre class="logs">${esc(result.output || '(no output)')}</pre>`;
  } catch (error) {
    elementById('drawer-body').innerHTML = `<div class="empty">${esc((error as Error).message)}</div>`;
  }
}

function closeDrawer(): void {
  drawerMode = null;
  window.clearInterval(pollTimer);
  elementById('drawer').hidden = true;
}

/** Called on every state push: the follow-up form depends on the commands feature and on how the session runs. */
export function updateDrawer(state: DashboardState): void {
  latestState = state;
  canRunCommands = state.features.commands;
  syncDrawerForm();
}

async function sendFollowUp(): Promise<void> {
  if (drawerMode?.kind !== 'transcript') return;
  const prompt = elementById<HTMLTextAreaElement>('drawer-prompt').value;
  const permissionMode = elementById<HTMLSelectElement>('drawer-mode').value;
  const status = elementById('drawer-status');
  status.textContent = 'Sending…';
  try {
    const result = await api<CommandResult>(`/api/sessions/${encodeURIComponent(drawerMode.id)}/message`, { prompt, permissionMode });
    status.textContent = describeCommandResult(result);
    if (result.ok) elementById<HTMLTextAreaElement>('drawer-prompt').value = '';
  } catch (error) {
    status.textContent = (error as Error).message;
  }
}

/** Wire the drawer's close button, Escape key and follow-up form. */
export function initDrawer(): void {
  elementById('drawer-close').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && drawerMode) closeDrawer();
  });
  elementById('drawer-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void sendFollowUp();
  });
}
