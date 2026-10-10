import type { DashboardState } from '../../shared/types/index.ts';
import { elementById } from '../shared/dom.ts';
import { api } from '../shared/api.ts';

/** Follow `/api/events`: hand every pushed state to `onState`, show the connection status and report an unreadable push. */
export function connectStateStream(onState: (state: DashboardState) => void, onBadPush: () => void): void {
  const connection = elementById('conn');
  const stream = new EventSource('/api/events');
  stream.onmessage = (message) => {
    connection.textContent = 'live';
    connection.classList.add('is-live');
    let state: DashboardState;
    try {
      const parsed: unknown = JSON.parse(message.data);
      if (typeof parsed !== 'object' || !parsed) throw new Error('state is not an object');
      state = parsed as DashboardState;
    } catch (error) {
      console.error('bad state push', error);
      onBadPush();
      return;
    }
    onState(state);
  };
  stream.onerror = () => {
    connection.textContent = 'reconnecting…';
    connection.classList.remove('is-live');
    // An expired login shows up as a failing stream; this redirects to /login on 401.
    api('/api/state').catch(() => {});
  };
}
