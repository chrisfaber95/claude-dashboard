import { CommandError } from '../../claude/claude-cli.ts';
import { SEARCH_TOKEN, SEARCH_URL } from '../../config.ts';
import { isRecord } from '../../../shared/guards.ts';
import type { SearchAnswer, SearchCitation, SearchQueryResponse, SearchRequest, SearchResult } from '../../../shared/types/index.ts';

const QUESTION_MAX = 1000;
const FILTER_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/;
const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{1,100}$/;
const QUERY_TIMEOUT_MS = 15_000;
const ASK_TIMEOUT_MS = 90_000;
const FEEDBACK_TIMEOUT_MS = 10_000;
const RESPONSE_MAX_CHARS = 1_000_000;
const RESULTS_MAX = 20;
const CITATIONS_MAX = 20;
const FIELD_MAX = 300;
const SNIPPET_MAX = 600;
const ANSWER_MAX = 8000;

/** The only three calls the dashboard makes to the search service; nothing here can reach any other path. */
const SEARCH_PATHS = { query: '/query', ask: '/ask', feedback: '/feedback' } as const;

type FetchLike = typeof fetch;
type SearchPath = (typeof SEARCH_PATHS)[keyof typeof SEARCH_PATHS];

interface PostJson {
  doFetch: FetchLike;
  url: string;
  token?: string;
  body: unknown;
  timeoutMs: number;
}

/** One POST to the service; every failure becomes a fixed message so no address or token can leak. */
async function postJson(call: PostJson): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (call.token) headers.Authorization = `Bearer ${call.token}`;
  let response: Response;
  try {
    response = await call.doFetch(call.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(call.body),
      signal: AbortSignal.timeout(call.timeoutMs),
      redirect: 'error',
    });
  } catch {
    throw new CommandError(502, 'The search service is unreachable.');
  }
  if (!response.ok) throw new CommandError(502, 'The search service returned an error.');
  try {
    const raw = await response.text();
    if (raw.length > RESPONSE_MAX_CHARS) throw new Error('too large');
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new CommandError(502, 'The search service sent an unreadable answer.');
  }
}

/** Where the search service lives; tests inject their own fetch. */
export interface SearchOptions {
  baseUrl: string;
  token?: string;
  fetch?: FetchLike;
}

/** Calls to the search service: read-only query and ask, plus the thumbs-down feedback. */
export interface SearchClient {
  query(request: unknown): Promise<SearchQueryResponse>;
  ask(request: unknown): Promise<SearchAnswer>;
  feedback(body: unknown): Promise<void>;
}

/** The client for the configured service, or null when `DASHBOARD_SEARCH_URL` is not set. */
export function createConfiguredSearchClient(): SearchClient | null {
  return SEARCH_URL ? createSearchClient({ baseUrl: SEARCH_URL, token: SEARCH_TOKEN }) : null;
}

/** Validate a panel request: a question of 1 to 1000 characters and optional simple filters. */
export function parseSearchRequest(body: unknown): SearchRequest {
  if (!isRecord(body) || typeof body.question !== 'string') throw new CommandError(400, 'question is required');
  const question = body.question.trim();
  if (question.length === 0 || question.length > QUESTION_MAX) throw new CommandError(400, `question must be 1 to ${QUESTION_MAX} characters`);
  return {
    question,
    project: parseFilter(body.project, 'project'),
    sourceType: parseFilter(body.sourceType, 'source type'),
    hard: body.hard === true,
  };
}

function parseFilter(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !FILTER_RE.test(value)) throw new CommandError(400, `invalid ${name} filter`);
  return value;
}

/** Validate the thumbs-down body and return the router request id. */
export function parseFeedbackRequestId(body: unknown): string {
  if (!isRecord(body) || typeof body.requestId !== 'string' || !REQUEST_ID_RE.test(body.requestId)) {
    throw new CommandError(400, 'invalid request id');
  }
  return body.requestId;
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

/**
 * Keep an http(s) link, drop anything else. A link on the search service's own origin is dropped too, so the
 * service address never reaches the browser through a citation.
 */
function safeUrl(value: unknown, serviceOrigin: string): string {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.origin === serviceOrigin ? '' : url.href;
  } catch {
    return '';
  }
}

function toResult(value: unknown, serviceOrigin: string): SearchResult | null {
  if (!isRecord(value)) return null;
  const source = text(value.source ?? value.title, FIELD_MAX);
  if (!source) return null;
  return {
    source,
    location: text(value.location, FIELD_MAX),
    date: text(value.date, FIELD_MAX),
    project: text(value.project, FIELD_MAX),
    sourceType: text(value.source_type ?? value.sourceType, FIELD_MAX),
    snippet: text(value.snippet ?? value.text, SNIPPET_MAX),
    url: safeUrl(value.url, serviceOrigin),
  };
}

function toCitation(value: unknown, serviceOrigin: string): SearchCitation | null {
  if (!isRecord(value)) return null;
  const source = text(value.source ?? value.title, FIELD_MAX);
  if (!source) return null;
  return { source, location: text(value.location, FIELD_MAX), url: safeUrl(value.url, serviceOrigin) };
}

function mapList<T>(value: unknown, max: number, convert: (item: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, max).flatMap((item) => convert(item) ?? []);
}

/** Build the client. Only `query`, `ask` and `feedback` exist; every upstream failure becomes a fixed error message. */
export function createSearchClient(options: SearchOptions): SearchClient {
  const doFetch = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/+$/, '');
  const serviceOrigin = new URL(base).origin;

  const post = (path: SearchPath, body: unknown, timeoutMs: number): Promise<unknown> =>
    postJson({ doFetch, url: `${base}${path}`, token: options.token, body, timeoutMs });

  function filters(request: SearchRequest): Record<string, string | undefined> {
    return { project: request.project, source_type: request.sourceType };
  }

  return {
    async query(input) {
      const request = parseSearchRequest(input);
      const data = await post(SEARCH_PATHS.query, { query: request.question, limit: RESULTS_MAX, ...filters(request) }, QUERY_TIMEOUT_MS);
      return { results: mapList(isRecord(data) ? data.results : undefined, RESULTS_MAX, (item) => toResult(item, serviceOrigin)) };
    },
    async ask(input) {
      const request = parseSearchRequest(input);
      const data = await post(SEARCH_PATHS.ask, { question: request.question, hard: request.hard === true, ...filters(request) }, ASK_TIMEOUT_MS);
      if (!isRecord(data)) throw new CommandError(502, 'The search service sent an unreadable answer.');
      return {
        answer: text(data.answer, ANSWER_MAX),
        citations: mapList(data.citations, CITATIONS_MAX, (item) => toCitation(item, serviceOrigin)),
        requestId: REQUEST_ID_RE.test(text(data.request_id ?? data.requestId, 100)) ? text(data.request_id ?? data.requestId, 100) : '',
        backend: text(data.backend, FIELD_MAX),
      };
    },
    async feedback(input) {
      const requestId = parseFeedbackRequestId(input);
      await post(SEARCH_PATHS.feedback, { request_id: requestId, rating: 'down' }, FEEDBACK_TIMEOUT_MS);
    },
  };
}
