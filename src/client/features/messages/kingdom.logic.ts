// Pure model of the kingdom (no DOM, no geometry): the castle, the team-hq court, one district per project,
// buildings with workers, and the mailmen between them.
import type { Alert, MessageInfo, PermissionRequestInfo, SessionInfo, SubagentInfo } from '../../../shared/types/index.ts';
import { COURT_ID, areaIdOf, buildingKindOf } from './kingdom-grouping.logic.ts';
import { CASTLE_ID } from './kingdom-types.logic.ts';
import type {
  Kingdom,
  KingdomArea,
  KingdomBuilding,
  KingdomInput,
  KingdomMailman,
  KingdomTracker,
  KingdomWorker,
} from './kingdom-types.logic.ts';

export { CASTLE_ID };
export type * from './kingdom-types.logic.ts';

export const ACTIVE_WINDOW_MS = 30_000;
export const BUILDING_RETENTION_MS = 60 * 60_000;
export const MAILMAN_LIFETIME_MS = 30_000;
export const WORKERS_SHOWN_MAX = 6;
/** Two records (`out` and `in`) of one message are closer than this in time. */
const PAIR_WINDOW_MS = 5_000;
const SESSION_ALERT_PREFIX = 'session:';
export const BOSS_LABEL = 'boss';

interface Trip {
  key: string;
  from: string;
  to: string;
  insideBuilding: string | null;
  firstSeenMs: number;
}

interface SeenMessage {
  from: string;
  to: string;
  tsMs: number;
}

function messageKey(message: MessageInfo): string {
  return `${message.tsMs}|${message.kind}|${message.direction}|${message.sessionId}|${message.peer}`;
}

function routeOf(message: MessageInfo): { from: string; to: string } {
  if (message.kind === 'subagent') return { from: message.agentId ?? message.peer, to: BOSS_LABEL };
  if (message.direction === 'out') return { from: message.sessionName, to: message.peer };
  return { from: message.peer, to: message.sessionName };
}

function buildMailmen(trips: readonly Trip[], buildingNames: ReadonlySet<string>, nowMs: number): KingdomMailman[] {
  return trips
    .filter((trip) => {
      if (trip.insideBuilding) return buildingNames.has(trip.insideBuilding);
      return buildingNames.has(trip.from) && (trip.to === CASTLE_ID || buildingNames.has(trip.to));
    })
    .map((trip) => ({
      key: trip.key,
      from: trip.from,
      to: trip.to,
      insideBuilding: trip.insideBuilding,
      progress: Math.min(1, (nowMs - trip.firstSeenMs) / MAILMAN_LIFETIME_MS),
    }));
}

function lastMessageTimes(messages: readonly MessageInfo[]): Map<string, number> {
  const latest = new Map<string, number>();
  for (const message of messages) {
    if (message.kind !== 'session') continue;
    for (const name of [message.sessionName, message.peer]) {
      latest.set(name, Math.max(latest.get(name) ?? 0, message.tsMs));
    }
  }
  return latest;
}

function buildingState(isRunning: boolean, lastMessageMs: number | undefined, nowMs: number): 'active' | 'idle' | 'stopped' {
  if (!isRunning) return 'stopped';
  const isActive = lastMessageMs !== undefined && nowMs - lastMessageMs < ACTIVE_WINDOW_MS;
  return isActive ? 'active' : 'idle';
}

function workersOf(sessionId: string | undefined, subagents: readonly SubagentInfo[]): KingdomWorker[] {
  if (!sessionId) return [];
  return subagents
    .filter((subagent) => subagent.sessionId === sessionId && subagent.state === 'working')
    .map((subagent) => ({ agentId: subagent.agentId, agentType: subagent.agentType, activity: subagent.activity }));
}

/** Session alerts and pending permission requests, keyed by their id, with the session each belongs to. */
function attentionItems(alerts: readonly Alert[], permissions: readonly PermissionRequestInfo[]): Map<string, string> {
  const items = new Map<string, string>();
  for (const alert of alerts) {
    if (alert.id.startsWith(SESSION_ALERT_PREFIX)) items.set(alert.id, alert.id.slice(SESSION_ALERT_PREFIX.length));
  }
  for (const permission of permissions) {
    if (permission.status === 'pending') items.set(`permission:${permission.id}`, permission.sessionId);
  }
  return items;
}

class KingdomModel implements KingdomTracker {
  private readonly slotByBuilding = new Map<string, number>();
  private readonly projectByName = new Map<string, string>();
  private areaOrder: string[] = [];
  private readonly seen = new Map<string, SeenMessage>();
  private readonly seenAttention = new Set<string>();
  private trips: Trip[] = [];
  private isFirstCall = true;

  update(input: KingdomInput): Kingdom {
    const { sessions, messages, subagents, alerts, permissions, nowMs } = input;
    this.sightMessages(messages, nowMs);
    this.sightAttention(sessions, alerts, permissions, nowMs);
    this.isFirstCall = false;
    this.trips = this.trips.filter((trip) => nowMs - trip.firstSeenMs < MAILMAN_LIFETIME_MS);

    const latest = lastMessageTimes(messages);
    const runningByName = new Map(sessions.map((session) => [session.name, session]));
    for (const session of sessions) this.projectByName.set(session.name, session.project);
    const names = [...runningByName.keys()];
    for (const [name, lastMs] of latest) {
      if (!runningByName.has(name) && nowMs - lastMs < BUILDING_RETENTION_MS) names.push(name);
    }
    const buildings = names.map((name) => this.buildBuilding(name, runningByName.get(name), latest.get(name), subagents, nowMs));
    return {
      castle: { id: CASTLE_ID, needsYou: alerts.length > 0 || permissions.some((request) => request.status === 'pending') },
      areas: this.arrange(buildings),
      mailmen: buildMailmen(this.trips, new Set(names), nowMs),
    };
  }

  /** Groups buildings into areas; areas and slots keep their place while their content stays on screen. */
  private arrange(buildings: readonly KingdomBuilding[]): KingdomArea[] {
    const present = new Set(buildings.map((building) => building.areaId));
    this.areaOrder = this.areaOrder.filter((id) => present.has(id));
    for (const id of [COURT_ID, ...present]) {
      if (present.has(id) && !this.areaOrder.includes(id)) this.areaOrder.push(id);
    }
    const livingKeys = new Set(buildings.map((building) => `${building.areaId}|${building.name}`));
    for (const key of [...this.slotByBuilding.keys()]) {
      if (!livingKeys.has(key)) this.slotByBuilding.delete(key);
    }
    return this.areaOrder.map((id) => {
      const inArea = buildings.filter((building) => building.areaId === id);
      for (const building of inArea) building.slot = this.slotFor(`${id}|${building.name}`);
      inArea.sort((a, b) => a.slot - b.slot);
      return { id, kind: id === COURT_ID ? 'court' : 'district', buildings: inArea };
    });
  }

  /** The slot already given to this building, else the lowest free one of its area. */
  private slotFor(key: string): number {
    const known = this.slotByBuilding.get(key);
    if (known !== undefined) return known;
    const areaPrefix = key.slice(0, key.indexOf('|') + 1);
    const taken = new Set<number>();
    for (const [otherKey, slot] of this.slotByBuilding) {
      if (otherKey.startsWith(areaPrefix)) taken.add(slot);
    }
    let slot = 0;
    while (taken.has(slot)) slot++;
    this.slotByBuilding.set(key, slot);
    return slot;
  }

  private isKnownPair(from: string, to: string, tsMs: number): boolean {
    for (const other of this.seen.values()) {
      if (other.from === from && other.to === to && Math.abs(other.tsMs - tsMs) <= PAIR_WINDOW_MS) return true;
    }
    return false;
  }

  private sightMessages(messages: readonly MessageInfo[], nowMs: number): void {
    const currentKeys = new Set<string>();
    for (const message of messages) {
      const key = messageKey(message);
      currentKeys.add(key);
      if (this.seen.has(key)) continue;
      const isSubagent = message.kind === 'subagent';
      const { from, to } = routeOf(message);
      const isDuplicate = !isSubagent && this.isKnownPair(from, to, message.tsMs);
      this.seen.set(key, { from, to, tsMs: message.tsMs });
      const isNew = !this.isFirstCall || nowMs - message.tsMs < MAILMAN_LIFETIME_MS;
      if (isDuplicate || !isNew) continue;
      this.trips.push({ key, from, to, insideBuilding: isSubagent ? message.sessionName : null, firstSeenMs: nowMs });
    }
    for (const key of [...this.seen.keys()]) {
      if (!currentKeys.has(key)) this.seen.delete(key);
    }
  }

  /** A mailman to the castle for every alert or permission request that appears after the first update. */
  private sightAttention(
    sessions: readonly SessionInfo[],
    alerts: readonly Alert[],
    permissions: readonly PermissionRequestInfo[],
    nowMs: number,
  ): void {
    const current = attentionItems(alerts, permissions);
    for (const [key, sessionId] of current) {
      if (this.seenAttention.has(key)) continue;
      this.seenAttention.add(key);
      const owner = sessions.find((session) => session.sessionId === sessionId);
      if (this.isFirstCall || !owner) continue;
      this.trips.push({ key: `castle|${key}`, from: owner.name, to: CASTLE_ID, insideBuilding: null, firstSeenMs: nowMs });
    }
    for (const key of [...this.seenAttention]) {
      if (!current.has(key)) this.seenAttention.delete(key);
    }
  }

  private buildBuilding(
    name: string,
    session: SessionInfo | undefined,
    lastMessageMs: number | undefined,
    subagents: readonly SubagentInfo[],
    nowMs: number,
  ): KingdomBuilding {
    const state = buildingState(session !== undefined, lastMessageMs, nowMs);
    const lastActivityMs = Math.max(lastMessageMs ?? 0, session?.updatedAtMs ?? 0);
    const workers = workersOf(session?.sessionId, subagents);
    return {
      name,
      kind: buildingKindOf(name),
      state,
      idleMs: state === 'idle' ? Math.max(0, nowMs - lastActivityMs) : null,
      areaId: areaIdOf(name, session?.project ?? this.projectByName.get(name) ?? null),
      slot: 0,
      workers: workers.slice(0, WORKERS_SHOWN_MAX),
      moreWorkers: Math.max(0, workers.length - WORKERS_SHOWN_MAX),
    };
  }
}

/** Create a tracker; call `update` with every push while the popup is open, drop it when the popup closes. */
export function createKingdomTracker(): KingdomTracker {
  return new KingdomModel();
}
