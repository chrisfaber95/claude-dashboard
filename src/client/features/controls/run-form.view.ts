import type { CommandResult } from '../../../shared/types/index.ts';
import { api } from '../../shared/api.ts';
import { elementById } from '../../shared/dom.ts';
import { fieldsAfterLaunch, launchBody } from '../launch/launch.logic.ts';
import { describeCommandResult } from './controls.logic.ts';

async function submitRunForm(onStarted: () => void): Promise<void> {
  const status = elementById('run-status');
  const project = elementById<HTMLSelectElement>('run-project').value;
  const body = launchBody(
    project,
    elementById<HTMLTextAreaElement>('run-goal').value,
    elementById<HTMLTextAreaElement>('run-notes').value,
    elementById<HTMLSelectElement>('run-mode').value,
  );
  // Empty goal or no project: skip the confirm, the server answers with its own message, shown below; nothing starts.
  if (body.goal && project && !confirm(`Launch a background Claude session in ${project} (${body.permissionMode} mode)?`)) return;
  status.textContent = 'Starting…';
  let isStarted = false;
  try {
    const result = await api<CommandResult>('/api/commands', body);
    isStarted = result.ok;
    status.textContent = describeCommandResult(result);
  } catch (error) {
    status.textContent = (error as Error).message;
  }
  const clear = fieldsAfterLaunch(isStarted);
  if (clear.clearGoal) elementById<HTMLTextAreaElement>('run-goal').value = '';
  if (clear.clearNotes) elementById<HTMLTextAreaElement>('run-notes').value = '';
  if (isStarted) onStarted();
}

/** Wire the "start a background session" form; `onStarted` runs after a successful start. */
export function initRunForm(onStarted: () => void): void {
  elementById('run-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void submitRunForm(onStarted);
  });
}
