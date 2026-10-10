import type { CommandResult, DashboardState, SessionSummary } from '../shared/types/index.ts';
import { answer, parseIntent } from './chat-logic.ts';
import { createChatState } from './chat-state.ts';
import { openTranscript } from './controls.ts';
import { $, api } from './util.ts';

// The chat may only send a message to a session, dismiss an alert and read a session summary (plus open a transcript).
// It never starts or stops sessions. tests/chat.test.ts scans this file for that.

const chat = createChatState();
let latest: DashboardState | null = null;
let rendered = 0;
let busy = false;

/** Same default as the transcript drawer; never a mode the server does not list. */
function permissionMode(): string {
  const modes = latest?.features.permissionModes ?? [];
  return modes.includes('auto') ? 'auto' : modes.includes('default') ? 'default' : 'plan';
}

function line(role: 'user' | 'bot', text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = `chat__msg chat__msg--${role}`;
  el.textContent = text;
  return el;
}

function log(): HTMLElement {
  return $('chat-log');
}

/** Appends entries added since the last call and trims the DOM to the bounded history. */
function syncLog(): void {
  const box = log();
  const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  for (const e of chat.history) {
    if (e.id <= rendered) continue;
    const el = line(e.role, e.text);
    el.dataset['id'] = String(e.id);
    box.insertBefore(el, $('chat-confirm'));
    rendered = e.id;
  }
  const first = chat.history[0]?.id ?? 0;
  for (const el of Array.from(box.querySelectorAll<HTMLElement>('[data-id]'))) {
    if (Number(el.dataset['id']) < first) el.remove();
  }
  if (stick) box.scrollTop = box.scrollHeight;
}

function showConfirm(): void {
  const p = chat.pending;
  const box = $('chat-confirm');
  box.hidden = !p;
  $('chat-confirm-name').textContent = p ? p.name : '';
  $('chat-confirm-text').textContent = p ? p.text : '';
  if (p) log().scrollTop = log().scrollHeight;
}

function bot(text: string): void {
  chat.addBot(text);
  syncLog();
}

async function sendMessage(): Promise<void> {
  const p = chat.confirm();
  showConfirm();
  if (!p) return;
  if (!latest?.sessions.some((x) => x.sessionId === p.sessionId)) {
    bot(`${p.name} is no longer running. Nothing was sent.`);
    return;
  }
  busy = true;
  try {
    const r = await api<CommandResult>(`/api/sessions/${encodeURIComponent(p.sessionId)}/message`, { prompt: p.text, permissionMode: permissionMode() });
    bot(r.ok ? `Sent to ${p.name}.` : r.output || 'Could not send the message.');
  } catch (e) {
    bot((e as Error).message);
  } finally {
    busy = false;
  }
}

async function showSummary(sessionId: string): Promise<void> {
  busy = true;
  try {
    const r = await api<SessionSummary>(`/api/sessions/${encodeURIComponent(sessionId)}/summary`);
    bot(r.text);
    if (r.note) bot(r.note);
  } catch (e) {
    bot((e as Error).message);
  } finally {
    busy = false;
  }
}

async function dismissAlert(id: string, title: string): Promise<void> {
  busy = true;
  try {
    await api('/api/alerts/dismiss', { id });
    bot(`Dismissed "${title}".`);
  } catch (e) {
    bot((e as Error).message);
  } finally {
    busy = false;
  }
}

async function handle(text: string): Promise<void> {
  chat.addUser(text);
  showConfirm();
  syncLog();
  if (!latest) {
    bot('Waiting for the first data from the dashboard, try again in a moment.');
    return;
  }
  const intent = parseIntent(text, latest);
  const reply = answer(intent, latest);
  switch (intent.kind) {
    case 'message':
      bot(reply);
      if (intent.match.kind === 'one') {
        chat.setPending({ sessionId: intent.match.item.sessionId, name: intent.match.item.name, text: intent.text });
        showConfirm();
      }
      return;
    case 'ack':
      bot(reply);
      if (intent.match.kind === 'one') await dismissAlert(intent.match.item.id, intent.match.item.title);
      return;
    case 'open':
      bot(reply);
      if (intent.match.kind === 'one') openTranscript(intent.match.item.sessionId, intent.match.item.name);
      return;
    case 'summary':
      bot(reply);
      if (intent.match.kind === 'one') await showSummary(intent.match.item.sessionId);
      return;
    default:
      bot(reply);
  }
}

/** Builds nothing: the markup is static in index.html. Wires the form once. */
export function initChat(): void {
  const input = $<HTMLInputElement>('chat-input');
  $('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || busy) return;
    input.value = '';
    void handle(text);
  });
  $('chat-confirm-yes').addEventListener('click', () => void sendMessage());
  $('chat-confirm-no').addEventListener('click', () => {
    chat.cancel();
    showConfirm();
    bot('Cancelled. Nothing was sent.');
  });
  bot('Ask what is going on, or type "help".');
}

/** Called on every state push. Only remembers the state; the form and history are not touched. */
export function updateChat(s: DashboardState): void {
  latest = s;
}
