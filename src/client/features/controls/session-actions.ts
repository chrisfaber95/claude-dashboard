import type { CommandResult } from '../../../shared/types/index.ts';
import { useDashboardState } from '../../app/dashboard-state.ts';
import { api } from '../../shared/api.ts';
import { describeCommandResult, resolveSession } from './controls.logic.ts';
import { openTranscript } from './transcript-drawer-selection.ts';
import { showToast } from './use-toasts.ts';

/** Outcome of a follow-up: the status line to show and whether the prompt was accepted. */
export interface ContinueOutcome {
  isOk: boolean;
  text: string;
}

function failureText(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed.';
}

/** Ask for confirmation, then stop a background session; the result is shown as a toast. */
export async function stopSession(id: string, name: string): Promise<void> {
  if (!confirm(`Stop background session ${name}? Its conversation is kept.`)) return;
  try {
    const result = await api<CommandResult>(`/api/sessions/${encodeURIComponent(id)}/stop`, {});
    showToast(result.ok ? 'Stopped.' : result.output || 'Stop failed.', !result.ok);
  } catch (error) {
    showToast(failureText(error), true);
  }
}

/** Send a follow-up prompt that continues a session as a background run. */
export async function continueSession(id: string, prompt: string, permissionMode: string): Promise<ContinueOutcome> {
  try {
    const result = await api<CommandResult>(`/api/sessions/${encodeURIComponent(id)}/message`, { prompt, permissionMode });
    return { isOk: result.ok, text: describeCommandResult(result) };
  } catch (error) {
    return { isOk: false, text: failureText(error) };
  }
}

/** Open the transcript of a launch from its short background id; toasts when the session isn't known yet. */
export function openRecentLaunch(shortId: string, launchName: string): void {
  const state = useDashboardState().value;
  const found = state ? resolveSession(shortId, state.sessions, state.recentSessions) : null;
  if (found) openTranscript(found.id, found.isLive ? found.name : launchName);
  else showToast('Session not found yet, try again in a moment');
}
