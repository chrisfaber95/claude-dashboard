// Shapes of the kingdom model: its input from one dashboard push and the kingdom it returns.
import type { Alert, MessageInfo, PermissionRequestInfo, SessionInfo, SubagentInfo } from '../../../shared/types/index.ts';
import type { BuildingKind } from './kingdom-grouping.logic.ts';

/** Id of the castle as a mailman destination; no session name can start with `@`. */
export const CASTLE_ID = '@castle';

/** Everything the model needs from one dashboard push. */
export interface KingdomInput {
  sessions: readonly SessionInfo[];
  messages: readonly MessageInfo[];
  subagents: readonly SubagentInfo[];
  alerts: readonly Alert[];
  permissions: readonly PermissionRequestInfo[];
  nowMs: number;
}

/** A subagent drawn inside a building. */
export interface KingdomWorker {
  agentId: string;
  agentType: string;
  activity: string;
}

/** One session as a building. `idleMs` is set only while `idle`. */
export interface KingdomBuilding {
  name: string;
  kind: BuildingKind;
  state: 'active' | 'idle' | 'stopped';
  idleMs: number | null;
  /** Id of the court or district it stands in. */
  areaId: string;
  /** Stable slot inside its area. */
  slot: number;
  workers: KingdomWorker[];
  /** Working subagents beyond `WORKERS_SHOWN_MAX`, drawn as "+N more". */
  moreWorkers: number;
}

/** The main court (`@court`) or the district of one project. */
export interface KingdomArea {
  id: string;
  kind: 'court' | 'district';
  /** Buildings ordered by slot. */
  buildings: KingdomBuilding[];
}

/** The castle is the user; it needs them while an alert or a permission request is pending. */
export interface KingdomCastle {
  id: typeof CASTLE_ID;
  needsYou: boolean;
}

/** A mailman between two buildings, from a building to the castle, or inside one building (worker to boss). */
export interface KingdomMailman {
  key: string;
  from: string;
  /** A building name, `BOSS_LABEL` or `CASTLE_ID`. */
  to: string;
  /** Set for a subagent hand-back: the building it happens in. */
  insideBuilding: string | null;
  /** 0 at first sighting, 1 when it disappears. */
  progress: number;
}

/** The kingdom at one moment. */
export interface Kingdom {
  castle: KingdomCastle;
  areas: KingdomArea[];
  mailmen: KingdomMailman[];
}

/** Keeps slots, area order and first sightings across calls while the popup is open. */
export interface KingdomTracker {
  update(input: KingdomInput): Kingdom;
}
