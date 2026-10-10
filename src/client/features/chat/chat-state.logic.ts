// Pure chat panel state (no DOM, no network): bounded history and the single pending confirmation.

/** Who wrote a chat line. */
export type ChatRole = 'user' | 'bot';

/** One line of the chat history. */
export interface ChatEntry {
  id: number;
  role: ChatRole;
  text: string;
}

/** What Confirm will send: captured when the confirmation was created, never re-parsed. */
export interface PendingMessage {
  sessionId: string;
  name: string;
  text: string;
}

/** How many chat lines are kept. */
export const HISTORY_MAX = 50;

/** The chat history plus the single pending confirmation. */
export interface ChatState {
  readonly history: readonly ChatEntry[];
  readonly pending: PendingMessage | null;
  /** Records what the user typed. Any pending confirmation is cancelled. */
  addUser(text: string): ChatEntry;
  addBot(text: string): ChatEntry;
  /** Asks for confirmation of exactly this message. Replaces an earlier pending one. */
  setPending(message: PendingMessage): void;
  /** Returns what to send and clears it, so a second call returns null. */
  confirm(): PendingMessage | null;
  cancel(): void;
}

/** A fresh chat state that keeps at most `max` lines. */
export function createChatState(max: number = HISTORY_MAX): ChatState {
  let history: ChatEntry[] = [];
  let pending: PendingMessage | null = null;
  let nextId = 1;

  const add = (role: ChatRole, text: string): ChatEntry => {
    const entry: ChatEntry = { id: nextId++, role, text };
    history = [...history, entry].slice(-max);
    return entry;
  };

  return {
    get history() {
      return history;
    },
    get pending() {
      return pending;
    },
    addUser(text) {
      pending = null;
      return add('user', text);
    },
    addBot: (text) => add('bot', text),
    setPending(message) {
      pending = { sessionId: message.sessionId, name: message.name, text: message.text };
    },
    confirm() {
      const confirmed = pending;
      pending = null;
      return confirmed;
    },
    cancel() {
      pending = null;
    },
  };
}
