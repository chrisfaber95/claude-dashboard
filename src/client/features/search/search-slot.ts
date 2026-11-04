import type { Ref } from 'vue';
import type { SearchRequest } from '../../../shared/types/index.ts';
import { messageOf } from './search-calls.ts';

interface SlotParts<T> {
  data: Ref<T | null>;
  error: Ref<string>;
  fetcher: (request: SearchRequest) => Promise<T>;
  getRun: () => number;
  onData?: () => void;
}

/** Run a call and keep its outcome only while no newer search has started (`getRun` moved on = stale). */
export function createSlot<T>(parts: SlotParts<T>): { start(request: SearchRequest, thisRun: number): Promise<void>; retry(): Promise<void> } {
  let last: SearchRequest | null = null;

  async function start(request: SearchRequest, thisRun: number): Promise<void> {
    last = request;
    try {
      const value = await parts.fetcher(request);
      if (thisRun !== parts.getRun()) return;
      parts.data.value = value;
      parts.onData?.();
    } catch (error) {
      if (thisRun === parts.getRun()) parts.error.value = messageOf(error);
    }
  }

  async function retry(): Promise<void> {
    if (!last) return;
    parts.error.value = '';
    await start(last, parts.getRun());
  }

  return { start, retry };
}
