import { CommandError, PROMPT_MAX } from './claude-cli.ts';

/** The goal is stored in the launch history cut to this many characters. */
export const GOAL_AUDIT_MAX = 500;

export interface LaunchRequest {
  /** The one prompt the session gets: goal first, then the notes in their own marked section. */
  prompt: string;
  goal: string;
  notesLength: number;
}

/**
 * Turn a start request into the session prompt. `goal` and optional `notes` are the new fields; the old
 * `prompt` field still counts as the goal. Every refusal is a fixed 400 message, before any CLI call.
 */
export function composeLaunch(body: Record<string, unknown>): LaunchRequest {
  const raw = body.goal ?? body.prompt;
  if (typeof raw !== 'string' || !raw.trim()) throw new CommandError(400, 'goal is required');
  if (body.notes !== undefined && body.notes !== null && typeof body.notes !== 'string') throw new CommandError(400, 'notes must be text');
  const goal = raw.trim();
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  // A prompt that is only a goal stays as typed, apart from the guard against a leading '-' being read as a flag.
  const prompt = notes ? `## Goal\n${goal}\n\n## Background notes\n${notes}` : /^-/.test(goal) ? `Task:\n${goal}` : goal;
  if (prompt.length > PROMPT_MAX) throw new CommandError(400, `goal and notes together are longer than ${PROMPT_MAX} characters`);
  return { prompt, goal, notesLength: notes.length };
}
