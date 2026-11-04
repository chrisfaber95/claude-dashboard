import { api, ApiError } from '../../shared/api.ts';
import type { SearchAnswer, SearchRequest, SearchResult } from '../../../shared/types/index.ts';
import { UNEXPECTED_RESPONSE, isSearchAnswer, isSearchQueryResponse } from './search.logic.ts';

/** The message to show for a failed call: the server's fixed text, else a generic unreachable text. */
export function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Search service unreachable';
}

/** Ask for an answer with citations. */
export async function fetchAnswer(request: SearchRequest): Promise<SearchAnswer> {
  const data = await api<unknown>('/api/search/ask', request);
  if (!isSearchAnswer(data)) throw new ApiError(UNEXPECTED_RESPONSE);
  return data;
}

/** Fetch the result list. */
export async function fetchResults(request: SearchRequest): Promise<SearchResult[]> {
  const data = await api<unknown>('/api/search/query', request);
  if (!isSearchQueryResponse(data)) throw new ApiError(UNEXPECTED_RESPONSE);
  return data.results;
}
