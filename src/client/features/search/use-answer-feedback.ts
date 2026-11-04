import { ref } from 'vue';
import type { Ref } from 'vue';
import { api } from '../../shared/api.ts';
import type { SearchAnswer } from '../../../shared/types/index.ts';
import { messageOf } from './search-calls.ts';

/** Where the thumbs-down of the current answer stands. */
export type FeedbackStatus = 'idle' | 'sending' | 'sent' | 'error';

/** What the panel reads and calls for the thumbs-down. */
export interface AnswerFeedback {
  status: Ref<FeedbackStatus>;
  error: Ref<string>;
  reset(): void;
  send(): Promise<void>;
}

/** The thumbs-down of the shown answer; a result that arrives after a newer search (`getRun` moved on) is ignored. */
export function useAnswerFeedback(answer: Ref<SearchAnswer | null>, getRun: () => number): AnswerFeedback {
  const status: Ref<FeedbackStatus> = ref('idle');
  const error = ref('');

  function reset(): void {
    status.value = 'idle';
    error.value = '';
  }

  async function send(): Promise<void> {
    const current = answer.value;
    if (!current || current.requestId === '' || status.value === 'sending' || status.value === 'sent') return;
    const thisRun = getRun();
    status.value = 'sending';
    try {
      await api<unknown>('/api/search/feedback', { requestId: current.requestId });
      if (thisRun === getRun() && answer.value === current) status.value = 'sent';
    } catch (caught) {
      if (thisRun !== getRun() || answer.value !== current) return;
      status.value = 'error';
      error.value = messageOf(caught);
    }
  }

  return { status, error, reset, send };
}
