import { computed, ref } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import type { SearchAnswer, SearchResult } from '../../../shared/types/index.ts';
import { fetchAnswer, fetchResults } from './search-calls.ts';
import { createSlot } from './search-slot.ts';
import { buildRequest, cleanQuestion, combinedError } from './search.logic.ts';
import { useAnswerFeedback } from './use-answer-feedback.ts';
import type { FeedbackStatus } from './use-answer-feedback.ts';

export type { FeedbackStatus };

/** What the Search panel template reads and calls. */
export interface SearchModel {
  answer: Ref<SearchAnswer | null>;
  results: Ref<SearchResult[] | null>;
  askError: Ref<string>;
  queryError: Ref<string>;
  isLoading: Ref<boolean>;
  hasSearched: Ref<boolean>;
  feedback: Ref<FeedbackStatus>;
  feedbackError: Ref<string>;
  hasBothFailed: ComputedRef<boolean>;
  bothError: ComputedRef<string>;
  submit(text: string, project: string, sourceType: string, isHard: boolean): Promise<void>;
  retryAsk(): Promise<void>;
  retryQuery(): Promise<void>;
  sendFeedback(): Promise<void>;
}

/** State and actions of the Search panel: two independent calls, stale responses dropped by a run counter. */
export function useSearch(): SearchModel {
  const answer: Ref<SearchAnswer | null> = ref(null);
  const results: Ref<SearchResult[] | null> = ref(null);
  const askError = ref('');
  const queryError = ref('');
  const isLoading = ref(false);
  const hasSearched = ref(false);
  let run = 0;
  const thumbs = useAnswerFeedback(answer, () => run);

  const getRun = (): number => run;
  const ask = createSlot({ data: answer, error: askError, fetcher: fetchAnswer, getRun, onData: thumbs.reset });
  const query = createSlot({ data: results, error: queryError, fetcher: fetchResults, getRun });

  async function submit(text: string, project: string, sourceType: string, isHard: boolean): Promise<void> {
    const question = cleanQuestion(text);
    if (question === null) return;
    run += 1;
    const thisRun = run;
    answer.value = null;
    results.value = null;
    askError.value = '';
    queryError.value = '';
    thumbs.reset();
    hasSearched.value = true;
    isLoading.value = true;
    await Promise.allSettled([
      ask.start(buildRequest(question, project, sourceType, isHard), thisRun),
      query.start(buildRequest(question, project, sourceType), thisRun),
    ]);
    if (thisRun === run) isLoading.value = false;
  }

  return {
    answer, results, askError, queryError, isLoading, hasSearched,
    feedback: thumbs.status,
    feedbackError: thumbs.error,
    hasBothFailed: computed(() => askError.value !== '' && queryError.value !== ''),
    bothError: computed(() => combinedError(askError.value, queryError.value)),
    submit,
    retryAsk: ask.retry,
    retryQuery: query.retry,
    sendFeedback: thumbs.send,
  };
}
