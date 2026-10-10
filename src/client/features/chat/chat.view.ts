import type { CommandResult, DashboardState, SessionSummary } from '../../../shared/types/index.ts';
import { answer, parseIntent } from './chat.logic.ts';
import { createChatState } from './chat-state.logic.ts';
import { openTranscript } from '../controls/controls.view.ts';
import { elementById } from '../../shared/dom.ts';
import { api } from '../../shared/api.ts';

// The chat may only send a message to a session, dismiss an alert and read a session summary (plus open a transcript).
// It never starts or stops sessions. tests/chat.test.ts scans this file for that.

const chat = createChatState();
let latest: DashboardState | null = null;
let rendered = 0;
let isBusy = false;
const STICK_TO_BOTTOM_PX = 40;

/** Same default as the transcript drawer; never a mode the server does not list. */
function permissionMode(): string {
  const modes = latest?.features.permissionModes ?? [];
  if (modes.includes('auto')) return 'auto';
  if (modes.includes('default')) return 'default';
  return 'plan';
}

function line(role: 'user' | 'bot', text: string): HTMLElement {
  const element = document.createElement('div');
  element.className = `chat__msg chat__msg--${role}`;
  element.textContent = text;
  return element;
}

function log(): HTMLElement {
  return elementById('chat-log');
}

/** Appends entries added since the last call and trims the DOM to the bounded history. */
function syncLog(): void {
  const box = log();
  const shouldStick = box.scrollHeight - box.scrollTop - box.clientHeight < STICK_TO_BOTTOM_PX;
  for (const entry of chat.history) {
    if (entry.id <= rendered) continue;
    const element = line(entry.role, entry.text);
    element.dataset['id'] = String(entry.id);
    box.insertBefore(element, elementById('chat-confirm'));
    rendered = entry.id;
  }
  const first = chat.history[0]?.id ?? 0;
  for (const element of Array.from(box.querySelectorAll<HTMLElement>('[data-id]'))) {
    if (Number(element.dataset['id']) < first) element.remove();
  }
  if (shouldStick) box.scrollTop = box.scrollHeight;
}

function showConfirm(): void {
  const pending = chat.pending;
  const box = elementById('chat-confirm');
  box.hidden = !pending;
  elementById('chat-confirm-name').textContent = pending ? pending.name : '';
  elementById('chat-confirm-text').textContent = pending ? pending.text : '';
  if (pending) log().scrollTop = log().scrollHeight;
}

function bot(text: string): void {
  chat.addBot(text);
  syncLog();
}

async function sendMessage(): Promise<void> {
  const pending = chat.confirm();
  showConfirm();
  if (!pending) return;
  if (!latest?.sessions.some((session) => session.sessionId === pending.sessionId)) {
    bot(`${pending.name} is no longer running. Nothing was sent.`);
    return;
  }
  isBusy = true;
  try {
    const result = await api<CommandResult>(`/api/sessions/${encodeURIComponent(pending.sessionId)}/message`, {
      prompt: pending.text,
      permissionMode: permissionMode(),
    });
    bot(result.ok ? `Sent to ${pending.name}.` : result.output || 'Could not send the message.');
  } catch (error) {
    bot((error as Error).message);
  } finally {
    isBusy = false;
  }
}

async function showSummary(sessionId: string): Promise<void> {
  isBusy = true;
  try {
    const summary = await api<SessionSummary>(`/api/sessions/${encodeURIComponent(sessionId)}/summary`);
    bot(summary.text);
    if (summary.note) bot(summary.note);
  } catch (error) {
    bot((error as Error).message);
  } finally {
    isBusy = false;
  }
}

async function dismissAlert(id: string, title: string): Promise<void> {
  isBusy = true;
  try {
    await api('/api/alerts/dismiss', { id });
    bot(`Dismissed "${title}".`);
  } catch (error) {
    bot((error as Error).message);
  } finally {
    isBusy = false;
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
  const input = elementById<HTMLInputElement>('chat-input');
  elementById('chat-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || isBusy) return;
    input.value = '';
    void handle(text);
  });
  elementById('chat-confirm-yes').addEventListener('click', () => void sendMessage());
  elementById('chat-confirm-no').addEventListener('click', () => {
    chat.cancel();
    showConfirm();
    bot('Cancelled. Nothing was sent.');
  });
  bot('Ask what is going on, or type "help".');
}

/** Called on every state push. Only remembers the state; the form and history are not touched. */
export function updateChat(state: DashboardState): void {
  latest = state;
}
