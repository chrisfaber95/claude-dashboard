/** Source types the Search panel offers as a filter; the search service owns the real list, so the server only checks the shape. */
export const SEARCH_SOURCE_TYPES = ['wiki', 'brief', 'transcript', 'repo-doc', 'code', 'memory'] as const;

/** What the panel sends for a search or a question; empty filters mean "all". */
export interface SearchRequest {
  question: string;
  project?: string;
  sourceType?: string;
  /** Ask for the claude tier instead of the local one (ask only). */
  hard?: boolean;
}

/** One hit of a query, as the dashboard backend normalises it. */
export interface SearchResult {
  source: string;
  /** Heading or turn inside the source. */
  location: string;
  /** ISO date or timestamp as the service reports it; empty when unknown. */
  date: string;
  project: string;
  sourceType: string;
  snippet: string;
  /** Only an http(s) link; empty when the service gave none. */
  url: string;
}

/** The result list of a query. */
export interface SearchQueryResponse {
  results: SearchResult[];
}

/** One source cited by an answer. */
export interface SearchCitation {
  source: string;
  location: string;
  /** Only an http(s) link; empty when the service gave none. */
  url: string;
}

/** The answer to a question: plain text, its citations and the router request id used for feedback. */
export interface SearchAnswer {
  answer: string;
  citations: SearchCitation[];
  /** Empty when the service sent none; without it no feedback can be given. */
  requestId: string;
  backend: string;
}
