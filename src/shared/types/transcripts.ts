export interface TranscriptEntry {
  uuid: string;
  tsMs: number;
  role: 'user' | 'assistant' | 'tool' | 'result' | 'peer';
  text: string;
  from?: string;
  isError?: boolean;
}

export interface TranscriptPage {
  entries: TranscriptEntry[];
  hasMore: boolean;
  /** Older history exists but is beyond the viewer's size cap. */
  truncated?: boolean;
}
