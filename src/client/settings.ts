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
      },
      () => {
        select.value = current;
        status.textContent = 'Could not save the summary setting.';
      },
    );
  });
}
