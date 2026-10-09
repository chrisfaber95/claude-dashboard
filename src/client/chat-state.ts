// Pure chat panel state (no DOM, no network): bounded history and the single pending confirmation.

export type ChatRole = 'user' | 'bot';

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

export const HISTORY_MAX = 50;

export interface ChatState {
  readonly history: readonly ChatEntry[];
  readonly pending: PendingMessage | null;
  /** Records what the user typed. Any pending confirmation is cancelled. */
  addUser(text: string): ChatEntry;
  addBot(text: string): ChatEntry;
  /** Asks for confirmation of exactly this message. Replaces an earlier pending one. */
  setPending(p: PendingMessage): void;
  /** Returns what to send and clears it, so a second call returns null. */
  confirm(): PendingMessage | null;
  cancel(): void;
}

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
    setPending(p) {
      pending = { sessionId: p.sessionId, name: p.name, text: p.text };
    },
    confirm() {
      const p = pending;
      pending = null;
      return p;
    },
    cancel() {
      pending = null;
    },
  };
}
