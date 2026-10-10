import type { TokenCounts } from '../../shared/types/index.ts';

/** One block of a message: text, a tool call or a tool result. Fields of the wrong type are left out. */
export interface ContentBlock {
  type: string;
  text?: string;
  /** tool_use: the call id. */
  id?: string;
  /** tool_use: the tool name. */
  name?: string;
  /** tool_use: the tool input. */
  input?: Record<string, unknown>;
  /** tool_result: the id of the call it answers. */
  toolUseId?: string;
  /** tool_result: a string or a list of blocks, read with `textOf` or `contentText`. */
  content?: unknown;
  isError: boolean;
}

/** Where a message came from (`kind` is `peer` for another session or a subagent). */
export interface MessageOrigin {
  kind: string;
  name?: string;
  from?: string;
  body?: string;
  senderTaskId?: string;
}

export interface TranscriptMessage {
  id?: string;
  model?: string;
  /** A plain string, or the blocks that could be read. */
  content?: string | ContentBlock[];
  /** Present only when the line carries a usage record. */
  usage?: TokenCounts;
}

export interface TranscriptAttachment {
  type?: string;
  prompt?: string;
  origin?: MessageOrigin;
}

/** The result of an Agent tool call, as stored next to the user line that carries it. */
export interface ToolUseResult {
  agentId?: string;
  status?: string;
  content?: unknown;
}

export interface QuotaLimits {
  status?: string;
  rateLimitType?: string;
  resetsAtSeconds?: number;
}

/** The fields of a transcript line that the dashboard reads. Every field is optional because lines vary. */
export interface TranscriptLine {
  type?: string;
  uuid?: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  requestId?: string;
  isMeta: boolean;
  isSidechain: boolean;
  origin?: MessageOrigin;
  message?: TranscriptMessage;
  attachment?: TranscriptAttachment;
  toolUseResult?: ToolUseResult;
  quotaLimits?: QuotaLimits;
}

/** Type guard for a parsed JSON object (not null, not an array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function toBlock(value: unknown): ContentBlock | undefined {
  if (!isRecord(value)) return undefined;
  const type = stringField(value, 'type');
  if (type === undefined) return undefined;
  const input = value.input;
  return {
    type,
    text: stringField(value, 'text'),
    id: stringField(value, 'id'),
    name: stringField(value, 'name'),
    input: isRecord(input) ? input : undefined,
    toolUseId: stringField(value, 'tool_use_id'),
    content: value.content,
    isError: value.is_error === true,
  };
}

function toBlocks(values: unknown[]): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const value of values) {
    const block = toBlock(value);
    if (block) blocks.push(block);
  }
  return blocks;
}

function toOrigin(value: unknown): MessageOrigin | undefined {
  if (!isRecord(value)) return undefined;
  const kind = stringField(value, 'kind');
  if (kind === undefined) return undefined;
  return {
    kind,
    name: stringField(value, 'name'),
    from: stringField(value, 'from'),
    body: stringField(value, 'body'),
    senderTaskId: stringField(value, 'senderTaskId'),
  };
}

function toUsage(value: unknown): TokenCounts | undefined {
  if (!isRecord(value)) return undefined;
  return {
    input: numberField(value, 'input_tokens') ?? 0,
    output: numberField(value, 'output_tokens') ?? 0,
    cacheRead: numberField(value, 'cache_read_input_tokens') ?? 0,
    cacheWrite: numberField(value, 'cache_creation_input_tokens') ?? 0,
  };
}

function toMessageContent(content: unknown): string | ContentBlock[] | undefined {
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? toBlocks(content) : undefined;
}

function toMessage(value: unknown): TranscriptMessage | undefined {
  if (!isRecord(value)) return undefined;
  return {
    id: stringField(value, 'id'),
    model: stringField(value, 'model'),
    content: toMessageContent(value.content),
    usage: toUsage(value.usage),
  };
}

function toAttachment(value: unknown): TranscriptAttachment | undefined {
  if (!isRecord(value)) return undefined;
  return { type: stringField(value, 'type'), prompt: stringField(value, 'prompt'), origin: toOrigin(value.origin) };
}

function toToolUseResult(value: unknown): ToolUseResult | undefined {
  if (!isRecord(value)) return undefined;
  return { agentId: stringField(value, 'agentId'), status: stringField(value, 'status'), content: value.content };
}

function toQuotaLimits(value: unknown): QuotaLimits | undefined {
  if (!isRecord(value)) return undefined;
  return {
    status: stringField(value, 'status'),
    rateLimitType: stringField(value, 'rateLimitType'),
    resetsAtSeconds: numberField(value, 'resetsAt'),
  };
}

/** Read the fields the dashboard uses from a parsed JSON value; `undefined` when it is not an object. */
export function toTranscriptLine(value: unknown): TranscriptLine | undefined {
  if (!isRecord(value)) return undefined;
  return {
    type: stringField(value, 'type'),
    uuid: stringField(value, 'uuid'),
    timestamp: stringField(value, 'timestamp'),
    sessionId: stringField(value, 'sessionId'),
    cwd: stringField(value, 'cwd'),
    gitBranch: stringField(value, 'gitBranch'),
    requestId: stringField(value, 'requestId'),
    isMeta: value.isMeta === true,
    isSidechain: value.isSidechain === true,
    origin: toOrigin(value.origin),
    message: toMessage(value.message),
    attachment: toAttachment(value.attachment),
    toolUseResult: toToolUseResult(value.toolUseResult),
    quotaLimits: toQuotaLimits(value.quotaLimits),
  };
}

/** Parse one JSONL line; `undefined` when it is unreadable (e.g. caught mid-write) or not an object. */
export function parseTranscriptLine(raw: string): TranscriptLine | undefined {
  try {
    return toTranscriptLine(JSON.parse(raw));
  } catch {
    return undefined;
  }
}
