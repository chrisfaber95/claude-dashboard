import type { DashboardState } from '../../shared/types/index.ts';
import { elementById } from '../shared/dom.ts';
import { api } from '../shared/api.ts';
import { isDashboardState, setDashboardState } from './dashboard-state.ts';

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

/** Follow `/api/events`: store every pushed state and hand it to `onState`, show the connection status and report an unreadable push. */
export function connectStateStream(onState: (state: DashboardState) => void, onBadPush: () => void): void {
  const connection = elementById('conn');
  const stream = new EventSource('/api/events');
  stream.onmessage = (message) => {
    connection.textContent = 'live';
    connection.classList.add('is-live');
    const state = readStatePush(message.data);
    if (!state) {
      onBadPush();
      return;
    }
    setDashboardState(state);
    onState(state);
  };
  stream.onerror = () => {
    connection.textContent = 'reconnecting…';
    connection.classList.remove('is-live');
    // An expired login shows up as a failing stream; this redirects to /login on 401.
    api('/api/state').catch(() => {});
  };
}
