import { shallowRef } from 'vue';
import type { Ref } from 'vue';
import type { DashboardState } from '../../shared/types/index.ts';
import { api } from '../shared/api.ts';
import { isDashboardState, setDashboardState } from './dashboard-state.ts';

/** Whether the push stream is up. */
export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting';

const connectionStatus = shallowRef<ConnectionStatus>('connecting');

/** The status of the push stream, for the header. */
export function useConnectionStatus(): Readonly<Ref<ConnectionStatus>> {
  return connectionStatus;
}

/** Parse one push; undefined when it is not valid JSON or not a dashboard state. */
function readStatePush(data: string): DashboardState | undefined {
  try {
    const parsed: unknown = JSON.parse(data);
    return isDashboardState(parsed) ? parsed : undefined;
  } catch (error) {
    console.error('bad state push', error);
    return undefined;
  }
}

/** Follow `/api/events`: store every pushed state, track the connection status and report an unreadable push. */
export function connectStateStream(onBadPush: () => void): void {
  const stream = new EventSource('/api/events');
  stream.onmessage = (message) => {
    connectionStatus.value = 'live';
    const state = readStatePush(message.data);
    if (!state) {
      onBadPush();
      return;
    }
    setDashboardState(state);
  };
  stream.onerror = () => {
    connectionStatus.value = 'reconnecting';
    // An expired login shows up as a failing stream; this redirects to /login on 401.
    api('/api/state').catch(() => {});
  };
}
