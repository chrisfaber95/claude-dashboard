import { shallowRef } from 'vue';
import type { Ref } from 'vue';
import type { DrawerMode } from './controls.logic.ts';

/** What the transcript drawer was asked to show. A new object per request, so reopening the same session reloads it. */
export interface DrawerRequest {
  mode: DrawerMode;
  title: string;
  subtitle: string;
}

const request = shallowRef<DrawerRequest | null>(null);

/** The open request, or null while the drawer is closed. The drawer component reads it reactively. */
export function useDrawerRequest(): Readonly<Ref<DrawerRequest | null>> {
  return request;
}

/** Open the drawer on a session's transcript and keep it current. */
export function openTranscript(id: string, name: string): void {
  request.value = { mode: { kind: 'transcript', id }, title: name, subtitle: `Session ${id}` };
}

/** Read-only view of what a subagent was told and what it did. */
export function openSubagentTranscript(id: string, name: string): void {
  request.value = { mode: { kind: 'subagent', id }, title: name, subtitle: `Subagent ${id}` };
}

/** Open the drawer on the recent terminal output of a background session. */
export async function openLogs(id: string, name: string): Promise<void> {
  request.value = { mode: { kind: 'logs', id }, title: `${name} logs`, subtitle: `Recent terminal output of ${id}` };
}

/** Close the drawer. */
export function closeDrawer(): void {
  request.value = null;
}
