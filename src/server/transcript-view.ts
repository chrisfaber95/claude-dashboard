import { open, stat } from 'node:fs/promises';
import type { TranscriptEntry, TranscriptPage } from '../shared/types.ts';

const RESULT_MAX = 2048;
const TEXT_MAX = 20_000;
/** Only the tail of very large transcripts is shown. */
export const VIEW_BYTES_MAX = 32 * 1024 * 1024;
const cache = new Map<string, { key: string; entries: TranscriptEntry[]; truncated: boolean }>();

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + `\n… (${s.length - max} more characters)` : s;
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((c) => c && typeof c === 'object' && (c as { type?: string }).type === 'text')
    .map((c) => String((c as { text: unknown }).text))
    .join('\n');
}

export function toolSummary(name: string, input: Record<string, unknown> | undefined, max = 300): string {
  if (!input) return name;
  const pick = input.command ?? input.file_path ?? input.pattern ?? input.url ?? input.query ?? input.description ?? input.prompt;
  const s = typeof pick === 'string' ? pick : JSON.stringify(input);
  return `${name}: ${s.replace(/\s+/g, ' ').slice(0, max)}`;
}

/**
 * Turn raw JSONL lines into readable entries. Thinking, attachments and system reminders are dropped.
 * Subagent transcripts mark every line as a sidechain, so they are only parsed with `sidechain` set.
 */
export function parseEntries(lines: string[], sidechain = false): TranscriptEntry[] {
  const out: TranscriptEntry[] = [];
  for (const raw of lines) {
    if (!raw) continue;
    let o: any;
    try {
      o = JSON.parse(raw);
    } catch {
      continue;
    }
    if (o.isMeta || (o.isSidechain && !sidechain)) continue;
    const base = { uuid: String(o.uuid ?? ''), tsMs: o.timestamp ? Date.parse(o.timestamp) : 0 };

    if (o.type === 'user') {
      if (o.origin?.kind === 'peer') {
        out.push({ ...base, role: 'peer', from: String(o.origin.from ?? ''), text: clip(String(o.origin.body ?? textOf(o.message?.content)), TEXT_MAX) });
        continue;
      }
      const content = o.message?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c?.type === 'tool_result') {
            const t = typeof c.content === 'string' ? c.content : textOf(c.content);
            out.push({ ...base, role: 'result', text: clip(t, RESULT_MAX), isError: Boolean(c.is_error) });
          }
        }
      }
      const text = textOf(content).trim();
      if (text && !text.startsWith('<system-reminder>')) out.push({ ...base, role: 'user', text: clip(text, TEXT_MAX) });
    } else if (o.type === 'assistant' && Array.isArray(o.message?.content)) {
      for (const c of o.message.content) {
        if (c?.type === 'text' && String(c.text).trim()) out.push({ ...base, role: 'assistant', text: clip(String(c.text), TEXT_MAX) });
        else if (c?.type === 'tool_use') out.push({ ...base, role: 'tool', text: toolSummary(String(c.name), c.input) });
      }
    }
  }
  return out;
}

/** Parsed entries of (at most the last VIEW_BYTES_MAX bytes of) a transcript, cached by size + mtime. */
async function loadEntries(path: string, maxBytes: number, sidechain: boolean): Promise<{ entries: TranscriptEntry[]; truncated: boolean }> {
  const st = await stat(path);
  const key = `${st.size}:${st.mtimeMs}:${maxBytes}:${sidechain}`;
  const hit = cache.get(path);
  if (hit?.key === key) return hit;
  const start = Math.max(0, st.size - maxBytes);
  const buf = Buffer.alloc(st.size - start);
  const fh = await open(path, 'r');
  try {
    await fh.read(buf, 0, buf.length, start);
  } finally {
    await fh.close();
  }
  const lines = buf.toString('utf8').split('\n');
  if (start > 0) lines.shift(); // first line is partial
  const value = { key, entries: parseEntries(lines, sidechain), truncated: start > 0 };
  cache.set(path, value);
  if (cache.size > 8) cache.delete(cache.keys().next().value!);
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
  const { entries: all, truncated } = await loadEntries(path, maxBytes, sidechain);
  let end = all.length;
  if (before) {
    const i = all.findIndex((e) => e.uuid === before);
    if (i >= 0) end = i;
  }
  const start = Math.max(0, end - limit);
  return { entries: all.slice(start, end), hasMore: start > 0, ...(truncated && start === 0 ? { truncated: true } : {}) };
}
