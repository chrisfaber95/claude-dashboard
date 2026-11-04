import { isRecord } from '../../../shared/guards.ts';
import type { SearchAnswer, SearchCitation, SearchQueryResponse, SearchRequest, SearchResult } from '../../../shared/types/index.ts';

/** Longest question the panel sends. */
export const MAX_QUESTION_LENGTH = 1000;

/** Shown when a response does not have the expected shape; never raw data. */
export const UNEXPECTED_RESPONSE = 'Unexpected response from the search service';

/** Only http(s) links are rendered as links; anything else (javascript:, data:, relative, malformed) is plain text. */
export function safeHref(url: unknown): string | null {
  if (typeof url !== 'string' || url.trim() === '') return null;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

/** Trimmed, length-capped question; null when nothing is left to search for. */
export function cleanQuestion(text: string): string | null {
  const trimmed = text.trim().slice(0, MAX_QUESTION_LENGTH);
  return trimmed === '' ? null : trimmed;
}

/** Request body for a search; empty filters are left out, `hard` is only sent for an ask. */
export function buildRequest(question: string, project: string, sourceType: string, hard?: boolean): SearchRequest {
  const request: SearchRequest = { question };
  if (project !== '') request.project = project;
  if (sourceType !== '') request.sourceType = sourceType;
  if (hard === true) request.hard = true;
  return request;
}

function isCitation(value: unknown): value is SearchCitation {
  return isRecord(value) && typeof value.source === 'string' && typeof value.location === 'string' && typeof value.url === 'string';
}

function isResult(value: unknown): value is SearchResult {
  return (
    isRecord(value) &&
    ['source', 'location', 'date', 'project', 'sourceType', 'snippet', 'url'].every((key) => typeof value[key] === 'string')
  );
}

/** True when a response body is a well-formed answer. */
export function isSearchAnswer(value: unknown): value is SearchAnswer {
  return (
    isRecord(value) &&
    typeof value.answer === 'string' &&
    typeof value.requestId === 'string' &&
    typeof value.backend === 'string' &&
    Array.isArray(value.citations) &&
    value.citations.every(isCitation)
  );
}

/** True when a response body is a well-formed result list. */
export function isSearchQueryResponse(value: unknown): value is SearchQueryResponse {
  return isRecord(value) && Array.isArray(value.results) && value.results.every(isResult);
}

/** Result location line: source and heading, joined by a separator, empty parts skipped. */
export function describeLocation(source: string, location: string): string {
  return [source, location].filter((part) => part !== '').join(' / ');
}

/** The one error shown when both calls failed; uses the server's fixed message. */
export function combinedError(askError: string, queryError: string): string {
  return askError || queryError || 'Search service unreachable';
}
