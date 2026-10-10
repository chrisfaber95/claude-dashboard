import type { IncomingMessage } from 'node:http';
import { CommandError } from '../claude/claude-cli.ts';

const BODY_MAX_BYTES = 64 * 1024;

/** Read a request body as text, answering 413 past the size cap. */
export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let isTooBig = false;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_MAX_BYTES) isTooBig = true;
      else chunks.push(chunk);
    });
    // Drain the whole body before answering so the client actually receives the 413.
    req.on('end', () => {
      if (isTooBig) reject(new CommandError(413, 'request body too large'));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

/** Read a request body as a JSON object; anything else is a 400. */
export async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  try {
    const value = JSON.parse(await readBody(req));
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch (error) {
    if (error instanceof CommandError) throw error;
  }
  throw new CommandError(400, 'expected a JSON object');
}
