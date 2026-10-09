import type { SummarySetting } from '../shared/types.ts';
import { SUMMARY_MODES } from '../shared/types.ts';
import { $, api } from './util.ts';

/** Session summary mode (recap or model) next to the chat. Status texts are fixed strings. */
export function initSummarySetting(): void {
  const select = $<HTMLSelectElement>('summary-mode');
  const status = $('summary-status');
  let current = select.value;

  api<SummarySetting>('/api/settings/summary').then(
    (s) => {
      if (SUMMARY_MODES.includes(s.summary)) {
        current = s.summary;
        select.value = s.summary;
        updateSummaryNote(commandsOn);
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
        updateSummaryNote(commandsOn);
      },
      () => {
        select.value = current;
        status.textContent = 'Could not save the summary setting.';
      },
    );
  });
}

let commandsOn = true;

/** Called on every state push: with commands off, `model` still saves but summaries fall back to the recap. */
export function updateSummaryNote(commands: boolean): void {
  commandsOn = commands;
  const select = $<HTMLSelectElement>('summary-mode');
  $('summary-note').hidden = commandsOn || select.value !== 'model';
}
