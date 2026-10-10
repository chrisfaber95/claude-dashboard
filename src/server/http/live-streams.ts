import type { ServerResponse } from 'node:http';
import { PC_DEVICE, type Auth } from '../auth/auth.ts';
import type { DashboardState } from './context.ts';

interface StreamOwner {
  deviceId: string;
  sessionId: string | null;
}

/** Open live-event (SSE) streams of the dashboard. */
export interface LiveStreams {
  add(res: ServerResponse, owner: StreamOwner): void;
  remove(res: ServerResponse): void;
  /** Number of open streams. */
  count(): number;
  /** Write one state frame to every stream, with the PC-only flags for the PC's own streams. */
  broadcast(state: DashboardState): void;
  closeAll(): void;
}

/** The device-management flag depends on the caller: only this PC (loopback `pc`) may manage devices. */
export function withManageDevices(state: DashboardState, canManage: boolean): DashboardState {
  return canManage ? { ...state, features: { ...state.features, manageDevices: true } } : state;
}

/**
 * Open streams with the device and the session each was opened with. A stream is closed at once when its session ends
 * (logout, expiry, the per-device cap) or its device is revoked. The PC (loopback) has no session.
 */
export function createLiveStreams(auth: Auth | null): LiveStreams {
  const streams = new Map<ServerResponse, StreamOwner>();
  const closeWhere = (matches: (owner: StreamOwner) => boolean) => {
    for (const [res, owner] of [...streams]) {
      if (!matches(owner)) continue;
      streams.delete(res);
      res.end();
    }
  };
  auth?.onRevoke((deviceId) => closeWhere((owner) => owner.deviceId === deviceId));
  auth?.onSessionEnd((sessionId) => closeWhere((owner) => owner.sessionId === sessionId));
  return {
    add: (res, owner) => void streams.set(res, owner),
    remove: (res) => void streams.delete(res),
    count: () => streams.size,
    broadcast(state) {
      const plainFrame = `data: ${JSON.stringify(state)}\n\n`;
      const pcFrame = `data: ${JSON.stringify(withManageDevices(state, true))}\n\n`;
      for (const [res, owner] of streams) res.write(owner.deviceId === PC_DEVICE ? pcFrame : plainFrame);
    },
    closeAll() {
      for (const res of streams.keys()) res.end();
    },
  };
}
