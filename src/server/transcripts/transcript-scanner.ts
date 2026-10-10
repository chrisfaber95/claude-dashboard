import { closeSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CLAUDE_DIR } from '../config.ts';
import {
  indexTranscript,
  noteProjectActivity,
  projectOf,
  recordLimitHit,
  recordMessages,
  recordUsage,
} from './transcript-aggregates.ts';
import { isSubagentPath, parentSessionIdOf, registerSubagent, trackSubagents } from './subagent-index.ts';
import type { SubagentRecord } from './subagent-index.ts';

interface FileState {
  offset: number;
  /** Trailing partial line carried to the next read. */
  carry: Buffer;
  sessionId: string;
  cwd: string;
  branch: string | null;
  /** Set for subagent transcripts (agent-<id>.jsonl). */
  agentId: string;
}

const MEGABYTE = 1024 * 1024;
const SCAN_CHUNK_BYTES = 16 * MEGABYTE;
const NEWLINE_BYTE = 10;
const files = new Map<string, FileState>();

/** Forget every file offset, so the next scan reads all transcripts from the start. */
export function resetScanner(): void {
  files.clear();
}

function* walk(dir: string): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(entryPath);
    else if (entry.name.endsWith('.jsonl')) yield entryPath;
  }
}

function parseLine(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** The subagent record of a line in a subagent transcript, caching the agent id on the file state. */
function subagentOf(fileState: FileState, filePath: string, project: string, tsMs: number): SubagentRecord | null {
  const { agentId, record } = registerSubagent({ filePath, project, tsMs, agentId: fileState.agentId });
  fileState.agentId = agentId;
  return record;
}

function handleLine(raw: string, fileState: FileState, filePath: string): void {
  const line = parseLine(raw);
  if (line === undefined) return;
  const tsMs = line.timestamp ? Date.parse(line.timestamp) : NaN;
  if (line.sessionId) fileState.sessionId = line.sessionId;
  if (line.cwd) fileState.cwd = line.cwd;
  if (line.gitBranch) fileState.branch = line.gitBranch;
  const sessionId = fileState.sessionId || filePath;
  const project = projectOf(fileState.cwd);
  const isSubagentFile = isSubagentPath(filePath);
  const subagent = isSubagentFile ? subagentOf(fileState, filePath, project, tsMs) : null;
  const hasTimestamp = !Number.isNaN(tsMs);

  if (hasTimestamp) noteProjectActivity(project, tsMs);

  // Subagent transcripts live under the parent session's folder; attribute their tokens to the parent.
  const attributedSessionId = isSubagentFile ? parentSessionIdOf(filePath) : sessionId;
  const counted = recordUsage(line, tsMs, {
    project,
    sessionId: attributedSessionId,
    cwd: fileState.cwd,
    branch: fileState.branch,
    isSubagentFile,
  });
  if (subagent && counted !== null) subagent.tokens += counted;

  recordLimitHit(line, tsMs, project);
  trackSubagents(line, subagent, tsMs);

  if (isSubagentFile || !hasTimestamp) return;
  if (fileState.sessionId && fileState.cwd) {
    indexTranscript(fileState.sessionId, { path: filePath, cwd: fileState.cwd, project, lastTsMs: tsMs });
  }
  recordMessages(line, tsMs, sessionId);
}

/** Handle every complete line of `data`; returns the trailing partial line to carry over. */
function consumeLines(data: Buffer, fileState: FileState, filePath: string): Buffer {
  let rest = data;
  let newlineIndex = rest.indexOf(NEWLINE_BYTE);
  while (newlineIndex !== -1) {
    const line = rest.subarray(0, newlineIndex).toString('utf8');
    rest = rest.subarray(newlineIndex + 1);
    if (line) handleLine(line, fileState, filePath);
    newlineIndex = rest.indexOf(NEWLINE_BYTE);
  }
  // A single line longer than the chunk size is dropped rather than buffered forever.
  return rest.length > SCAN_CHUNK_BYTES ? Buffer.alloc(0) : Buffer.from(rest);
}

/** Read the bytes after `fileState.offset`, in bounded chunks so one huge transcript can't exhaust memory. */
function readNewBytes(fileDescriptor: number, fileState: FileState, filePath: string, size: number): void {
  while (fileState.offset < size) {
    const chunk = Buffer.alloc(Math.min(SCAN_CHUNK_BYTES, size - fileState.offset));
    const bytesRead = readSync(fileDescriptor, chunk, 0, chunk.length, fileState.offset);
    if (bytesRead <= 0) break;
    fileState.offset += bytesRead;
    fileState.carry = consumeLines(Buffer.concat([fileState.carry, chunk.subarray(0, bytesRead)]), fileState, filePath);
  }
}

function scanFile(filePath: string): void {
  let size: number;
  try {
    size = statSync(filePath).size;
  } catch {
    return;
  }
  let fileState = files.get(filePath);
  if (!fileState) {
    fileState = { offset: 0, carry: Buffer.alloc(0), sessionId: '', cwd: '', branch: null, agentId: '' };
    files.set(filePath, fileState);
  }
  if (size < fileState.offset) {
    // truncated/rotated
    fileState.offset = 0;
    fileState.carry = Buffer.alloc(0);
  }
  if (size === fileState.offset) return;
  let fileDescriptor: number;
  try {
    fileDescriptor = openSync(filePath, 'r');
  } catch {
    return;
  }
  try {
    readNewBytes(fileDescriptor, fileState, filePath, size);
  } catch {
    // unreadable right now (locked or being rewritten); the next scan retries from fileState.offset
  } finally {
    closeSync(fileDescriptor);
  }
}

/** Incrementally read new bytes from every transcript. Read-only. */
export function scanTranscripts(): void {
  for (const filePath of walk(join(CLAUDE_DIR, 'projects'))) scanFile(filePath);
}
