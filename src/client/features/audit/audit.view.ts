import type { AuditEntry, DashboardState } from '../../../shared/types/index.ts';
import { ALL_DEVICES, auditQuery, mergeDeviceOptions, rowOf } from './audit.logic.ts';
import type { DeviceOption } from './audit.logic.ts';
import { elementById } from '../../shared/dom.ts';
import { api, ApiError } from '../../shared/api.ts';
import { esc } from '../../shared/escape.ts';

// Only these server strings may reach the page; anything else becomes the generic message.
const KNOWN_ERRORS = new Set(['invalid device filter', 'could not read the audit log']);
const GENERIC_ERROR = 'Could not load the activity.';

let options: DeviceOption[] = [];
let optionsHtml = '';
let listHtml = '';
let seq = 0;

function errText(err: unknown): string {
  return err instanceof ApiError && KNOWN_ERRORS.has(err.message) ? err.message : GENERIC_ERROR;
}

function setStatus(text: string): void {
  elementById('audit-status').textContent = text;
}

function rowHtml(entry: AuditEntry): string {
  const row = rowOf(entry);
  const mark = row.result ? `<span class="audit__result audit__result--${row.result}">${row.result}</span>` : '';
  const prompt = row.prompt ? `<div class="audit__prompt" data-tip="${esc(row.prompt)}">${esc(row.prompt)}</div>` : '';
  return `<li class="audit__item">
    <div class="audit__line"><span class="audit__time sub">${esc(row.time)}</span> <strong class="audit__device">${esc(row.device)}</strong> <span class="audit__action">${esc(row.action)}</span>${row.target ? ` <span class="audit__target">${esc(row.target)}</span>` : ''} ${mark}</div>${prompt}</li>`;
}

/** Rebuild the dropdown only when its options changed; the selected device stays selected even if it is no longer listed. */
function syncOptions(select: HTMLSelectElement, entries: readonly AuditEntry[]): void {
  const selected = select.value;
  options = mergeDeviceOptions(options, entries);
  const list = options.some((option) => option.id === selected) || selected === ALL_DEVICES ? options : [...options, { id: selected, name: selected }];
  const html = [`<option value="${ALL_DEVICES}">All devices</option>`, ...list.map((option) => `<option value="${esc(option.id)}">${esc(option.name)}</option>`)].join('');
  if (html === optionsHtml) return;
  optionsHtml = html;
  select.innerHTML = html;
  select.value = selected;
}

async function load(): Promise<void> {
  const select = elementById<HTMLSelectElement>('audit-device');
  const refresh = elementById<HTMLButtonElement>('audit-refresh');
  const mine = ++seq;
  refresh.disabled = true;
  setStatus('Loading...');
  try {
    const { entries } = await api<{ entries: AuditEntry[] }>(`/api/audit${auditQuery(select.value)}`);
    if (mine !== seq) return;
    syncOptions(select, entries);
    const html = entries.length ? entries.map(rowHtml).join('') : '<li class="empty">No activity yet.</li>';
    if (html !== listHtml) {
      listHtml = html;
      elementById('audit-list').innerHTML = html;
    }
    setStatus('');
  } catch (err) {
    if (mine === seq) {
      // Don't leave rows from another filter on screen next to an error.
      listHtml = '';
      elementById('audit-list').innerHTML = '';
      setStatus(errText(err));
    }
  } finally {
    if (mine === seq) refresh.disabled = false;
  }
}

/** Data loads on open, filter change and Refresh only; a state push has nothing to do here. */
export function renderAudit(_state: DashboardState): void {}

/** Wire the panel toggle, the device filter and the Refresh button. */
export function initAudit(): void {
  const panel = elementById<HTMLDetailsElement>('audit');
  panel.addEventListener('toggle', () => {
    if (panel.open) void load();
  });
  elementById('audit-device').addEventListener('change', () => void load());
  elementById('audit-refresh').addEventListener('click', () => void load());
}
