import { open, stat } from 'node:fs/promises';
import type { TranscriptEntry, TranscriptPage } from '../../shared/types/index.ts';

const RESULT_MAX_CHARS = 2048;
const TEXT_MAX_CHARS = 20_000;
const TOOL_SUMMARY_MAX_CHARS = 300;
const SNIPPET_MAX_CHARS = 220;
const MEGABYTE = 1024 * 1024;
/** Only the tail of very large transcripts is shown. */
export const VIEW_BYTES_MAX = 32 * MEGABYTE;
const CACHE_MAX_FILES = 8;

interface CachedEntries {
  key: string;
  entries: TranscriptEntry[];
  truncated: boolean;
}

interface EntryBase {
  uuid: string;
  tsMs: number;
}

const cache = new Map<string, CachedEntries>();

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + `\n… (${text.length - max} more characters)` : text;
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part && typeof part === 'object' && (part as { type?: string }).type === 'text')
    .map((part) => String((part as { text: unknown }).text))
    .join('\n');
}

/** Collapse whitespace and cut a text to `max` characters, marking the cut with an ellipsis. */
export function snippet(text: string, max = SNIPPET_MAX_CHARS): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? collapsed.slice(0, max - 1) + '…' : collapsed;
}

/** The plain text of a message content, which is a string or a list of blocks with `text`. */
export function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (part && typeof part === 'object' && 'text' in part ? String((part as { text: unknown }).text) : ''))
    .join(' ');
}

/** The report inside a "[Subagent hand-back]" body, without the harness preamble. */
export function handbackBody(body: string): string {
  return body.replace(/^\[Subagent hand-back\][\s\S]*?The report follows:\s*/, '').replace(/^\[Subagent hand-back\][^:]*:\s*/, '');
}

/** One-line description of a tool call: its name plus the most telling input. */
export function toolSummary(name: string, input: Record<string, unknown> | undefined, max = TOOL_SUMMARY_MAX_CHARS): string {
  if (!input) return name;
  const pick = input.command ?? input.file_path ?? input.pattern ?? input.url ?? input.query ?? input.description ?? input.prompt;
  const text = typeof pick === 'string' ? pick : JSON.stringify(input);
  return `${name}: ${text.replace(/\s+/g, ' ').slice(0, max)}`;
}

function originOf(line: any): any {
  if (line.type === 'user') return line.origin;
  if (line.type === 'attachment' && line.attachment?.type === 'queued_command') return line.attachment.origin;
  return undefined;
}

/** The peer origin of a line: on the user line itself, or (newer Claude Code) on a queued_command attachment. */
export function peerOrigin(line: any): any {
  const origin = originOf(line);
  return origin?.kind === 'peer' ? origin : undefined;
}

/**
 * Who sent a peer message: the session or subagent name, else `from`. Sessions on this PC send from a
 * local pipe address (`uds:\\.\pipe\...`), which means nothing to a reader, so that becomes 'unknown'.
 */
export function peerName(peer: any): string {
  if (peer.name) return String(peer.name);
  const from = String(peer.from ?? '');
  return from && !from.startsWith('uds:') ? from : 'unknown';
}

function userEntries(line: any, base: EntryBase): TranscriptEntry[] {
  const out: TranscriptEntry[] = [];
  const content = line.message?.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part?.type !== 'tool_result') continue;
      const text = typeof part.content === 'string' ? part.content : textOf(part.content);
      out.push({ ...base, role: 'result', text: clip(text, RESULT_MAX_CHARS), isError: Boolean(part.is_error) });
    }
  }
  const text = textOf(content).trim();
  if (text && !text.startsWith('<system-reminder>')) out.push({ ...base, role: 'user', text: clip(text, TEXT_MAX_CHARS) });
  return out;
}

function assistantEntries(content: any[], base: EntryBase): TranscriptEntry[] {
  const out: TranscriptEntry[] = [];
  for (const part of content) {
    if (part?.type === 'text' && String(part.text).trim()) {
      out.push({ ...base, role: 'assistant', text: clip(String(part.text), TEXT_MAX_CHARS) });
    } else if (part?.type === 'tool_use') {
      out.push({ ...base, role: 'tool', text: toolSummary(String(part.name), part.input) });
    }
  }
  return out;
}

function entriesOfLine(line: any, base: EntryBase): TranscriptEntry[] {
  // Subagent hand-backs in attachment form stay out: their report also comes back as the Agent tool result.
  const peer = peerOrigin(line);
  if (peer && (line.type === 'user' || !peer.senderTaskId)) {
    const text = clip(String(peer.body ?? textOf(line.message?.content)), TEXT_MAX_CHARS);
    return [{ ...base, role: 'peer', from: peerName(peer), text }];
  }
  if (line.type === 'user') return userEntries(line, base);
  if (line.type === 'assistant' && Array.isArray(line.message?.content)) return assistantEntries(line.message.content, base);
  return [];
}

/**
 * Turn raw JSONL lines into readable entries. Thinking, attachments and system reminders are dropped,
 * except session-to-session messages, which arrive as queued_command attachments.
 * Subagent transcripts mark every line as a sidechain, so they are only parsed with `sidechain` set.
 */
export function parseEntries(lines: string[], sidechain = false): TranscriptEntry[] {
  const out: TranscriptEntry[] = [];
  for (const raw of lines) {
    if (!raw) continue;
    let line: any;
    try {
      line = JSON.parse(raw);
    } catch {
      continue;
    }
    if (line.isMeta || (line.isSidechain && !sidechain)) continue;
    const base = { uuid: String(line.uuid ?? ''), tsMs: line.timestamp ? Date.parse(line.timestamp) : 0 };
    out.push(...entriesOfLine(line, base));
  }
  return out;
}

/** Parsed entries of (at most the last VIEW_BYTES_MAX bytes of) a transcript, cached by size + mtime. */
async function loadEntries(path: string, maxBytes: number, sidechain: boolean): Promise<CachedEntries> {
  const fileStat = await stat(path);
  const key = `${fileStat.size}:${fileStat.mtimeMs}:${maxBytes}:${sidechain}`;
  const hit = cache.get(path);
  if (hit?.key === key) return hit;
  const start = Math.max(0, fileStat.size - maxBytes);
  const buffer = Buffer.alloc(fileStat.size - start);
  const handle = await open(path, 'r');
  try {
    await handle.read(buffer, 0, buffer.length, start);
  } finally {
    await handle.close();
  }
  const lines = buffer.toString('utf8').split('\n');
  if (start > 0) lines.shift(); // first line is partial
  const value = { key, entries: parseEntries(lines, sidechain), truncated: start > 0 };
  cache.set(path, value);
  if (cache.size > CACHE_MAX_FILES) cache.delete(cache.keys().next().value!);
  return value;
}

/** Last `limit` entries, optionally those strictly before the entry with uuid `before`. */
export async function readTranscriptPage(
  path: string,
  limit: number,
  before?: string,
  maxBytes = VIEW_BYTES_MAX,
  sidechain = false,
): Promise<TranscriptPage> {
  const { entries: allEntries, truncated: isTruncated } = await loadEntries(path, maxBytes, sidechain);
  let end = allEntries.length;
  if (before) {
    const index = allEntries.findIndex((entry) => entry.uuid === before);
    if (index >= 0) end = index;
  }
  const start = Math.max(0, end - limit);
  return { entries: allEntries.slice(start, end), hasMore: start > 0, ...(isTruncated && start === 0 ? { truncated: true } : {}) };
}
