import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Auth, Identity } from '../auth/auth.ts';
import type { PermissionStore } from '../features/permissions/permissions.ts';
import type { buildState } from '../transcripts/state.ts';
import type { LiveStreams } from './live-streams.ts';

/** The state the API and the event stream send. */
export type DashboardState = ReturnType<typeof buildState> & { permissions: ReturnType<PermissionStore['list']> };

/** Everything the routes share for the lifetime of one server. */
export interface ServerContext {
  publicDir: string;
  /** Set in LAN mode, where a login is required. */
  auth: Auth | null;
  /** `https` with TLS, else `http`. */
  protocol: string;
  isTlsEnabled: boolean;
  areCommandsEnabled: boolean;
  projectsRoot: string;
  permissions: PermissionStore;
  streams: LiveStreams;
  buildDashboardState(): DashboardState;
  /** `--settings` file for sessions the dashboard starts; known once the server listens. */
  getSettingsFile(): string | undefined;
}

/** One request before anyone is identified. */
export interface RequestCall {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  ip: string;
}

/** Who is acting, for the audit log. */
export interface Actor {
  deviceId: string;
  device: string;
}

/** One request after the login gate. */
export interface AuthedCall extends RequestCall {
  /** Null without a login (localhost mode). */
  who: Identity | null;
  actor: Actor;
}

/** A route handler: returns true when it answered the request. */
export type RouteHandler = (context: ServerContext, call: AuthedCall) => Promise<boolean>;
