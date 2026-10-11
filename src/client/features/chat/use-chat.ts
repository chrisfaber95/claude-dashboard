import { ref } from 'vue';
import type { Ref } from 'vue';
import type { CommandResult, DashboardState, SessionSummary } from '../../../shared/types/index.ts';
import { useDashboardState } from '../../app/dashboard-state.ts';
import { api } from '../../shared/api.ts';
import { openTranscript } from '../controls/transcript-drawer-selection.ts';
import { answer, parseIntent } from './chat.logic.ts';
import { createChatState } from './chat-state.logic.ts';
import type { ChatEntry, ChatState, PendingMessage } from './chat-state.logic.ts';

// The chat may only send a message to a session, dismiss an alert and read a session summary (plus open a transcript).
// It never starts or stops sessions. tests/client/features/chat/chat.view.test.ts scans this file and the panel for that.

const FALLBACK_ERROR = 'Something went wrong.';

/** What the chat panel shows and the actions it can take. */
export interface ChatPanel {
  history: Readonly<Ref<readonly ChatEntry[]>>;
  pending: Readonly<Ref<PendingMessage | null>>;
  /** Returns false when the text was not taken (empty, or a request is still running). */
  submit(text: string): boolean;
  confirm(): Promise<void>;
  cancel(): void;
}

/** What the request helpers need: the latest push and a way to add a bot line. */
interface ChatContext {
  latest(): DashboardState | null;
  bot(text: string): void;
  runBusy(task: () => Promise<void>): Promise<void>;
}

/** Same default as the transcript drawer; never a mode the server does not list. */
function permissionMode(state: DashboardState | null): string {
  const modes = state?.features.permissionModes ?? [];
  if (modes.includes('auto')) return 'auto';
  if (modes.includes('default')) return 'default';
  return 'plan';
}

async function sendMessage(context: ChatContext, message: PendingMessage): Promise<void> {
  if (!context.latest()?.sessions.some((session) => session.sessionId === message.sessionId)) {
    context.bot(`${message.name} is no longer running. Nothing was sent.`);
    return;
  }
  await context.runBusy(async () => {
    const result = await api<CommandResult>(`/api/sessions/${encodeURIComponent(message.sessionId)}/message`, {
      prompt: message.text,
      permissionMode: permissionMode(context.latest()),
    });
    context.bot(result.ok ? `Sent to ${message.name}.` : result.output || 'Could not send the message.');
  });
}

async function showSummary(context: ChatContext, sessionId: string): Promise<void> {
  await context.runBusy(async () => {
    const summary = await api<SessionSummary>(`/api/sessions/${encodeURIComponent(sessionId)}/summary`);
    context.bot(summary.text);
    if (summary.note) context.bot(summary.note);
  });
}

async function dismissAlert(context: ChatContext, id: string, title: string): Promise<void> {
  await context.runBusy(async () => {
    await api('/api/alerts/dismiss', { id });
    context.bot(`Dismissed "${title}".`);
  });
}

/** Answers one typed line; a message to a session only becomes a pending confirmation. */
async function handleLine(context: ChatContext, chat: ChatState, text: string, afterPending: () => void): Promise<void> {
  const current = context.latest();
  if (!current) {
    context.bot('Waiting for the first data from the dashboard, try again in a moment.');
    return;
  }
  const intent = parseIntent(text, current);
  context.bot(answer(intent, current));
  switch (intent.kind) {
    case 'message':
      if (intent.match.kind !== 'one') return;
      chat.setPending({ sessionId: intent.match.item.sessionId, name: intent.match.item.name, text: intent.text });
      afterPending();
      return;
    case 'ack':
      if (intent.match.kind === 'one') await dismissAlert(context, intent.match.item.id, intent.match.item.title);
      return;
    case 'open':
      if (intent.match.kind === 'one') openTranscript(intent.match.item.sessionId, intent.match.item.name);
      return;
    case 'summary':
      if (intent.match.kind === 'one') await showSummary(context, intent.match.item.sessionId);
      return;
    default:
  }
}

/** Chat history, the pending confirmation and the intents behind them, driven by the latest dashboard push. */
export function useChat(): ChatPanel {
  const state = useDashboardState();
  const chat = createChatState();
  const history = ref<readonly ChatEntry[]>([]);
  const pending = ref<PendingMessage | null>(null);
  let isBusy = false;

  // The pure chat state is not reactive; copy it into refs after every change.
  function sync(): void {
    history.value = chat.history;
    pending.value = chat.pending;
  }

  const context: ChatContext = {
    latest: () => state.value,
    bot(text) {
      chat.addBot(text);
      sync();
    },
    async runBusy(task) {
      isBusy = true;
      try {
        await task();
      } catch (error) {
        context.bot(error instanceof Error ? error.message : FALLBACK_ERROR);
      } finally {
        isBusy = false;
      }
    },
  };

  context.bot('Ask what is going on, or type "help".');

  return {
    history,
    pending,
    submit(text) {
      const trimmed = text.trim();
      if (!trimmed || isBusy) return false;
      chat.addUser(trimmed);
      sync();
      void handleLine(context, chat, trimmed, sync);
      return true;
    },
    async confirm() {
      const message = chat.confirm();
      sync();
      if (message) await sendMessage(context, message);
    },
    cancel() {
      chat.cancel();
      context.bot('Cancelled. Nothing was sent.');
    },
  };
}
