import type { SummarySetting } from '../../../shared/types/index.ts';
import { SUMMARY_MODES } from '../../../shared/types/index.ts';
import { elementById } from '../../shared/dom.ts';
import { api } from '../../shared/api.ts';

/** Session summary mode (recap or model) next to the chat. Status texts are fixed strings. */
export function initSummarySetting(): void {
  const select = elementById<HTMLSelectElement>('summary-mode');
  const status = elementById('summary-status');
  let current = select.value;

  api<SummarySetting>('/api/settings/summary').then(
    (setting) => {
      if (SUMMARY_MODES.includes(setting.summary)) {
        current = setting.summary;
        select.value = setting.summary;
        updateSummaryNote(canRunCommands);
      }
    },
    () => (status.textContent = 'Could not load the summary setting.'),
  );

  select.addEventListener('change', () => {
    const next = select.value;
    status.textContent = '';
    api<SummarySetting>('/api/settings/summary', { summary: next }).then(
      () => {
        current = next;
        status.textContent = 'Saved.';
        updateSummaryNote(canRunCommands);
      },
      () => {
        select.value = current;
        status.textContent = 'Could not save the summary setting.';
      },
    );
  });
}

let canRunCommands = true;

/** Called on every state push: with commands off, `model` still saves but summaries fall back to the recap. */
export function updateSummaryNote(commands: boolean): void {
  canRunCommands = commands;
  const select = elementById<HTMLSelectElement>('summary-mode');
  elementById('summary-note').hidden = canRunCommands || select.value !== 'model';
}
