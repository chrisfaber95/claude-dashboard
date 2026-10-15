// Pure model of the message "city" (no DOM): which shops are on screen, who works inside, which postmen run.
import type { MessageInfo, SessionInfo, SubagentInfo } from '../../../shared/types/index.ts';

export const ACTIVE_WINDOW_MS = 30_000;
export const SHOP_RETENTION_MS = 60 * 60_000;
export const POSTMAN_LIFETIME_MS = 30_000;
export const WORKERS_SHOWN_MAX = 6;
export const SHOP_COLUMNS = 4;
/** Two records (`out` and `in`) of one message are closer than this in time. */
const PAIR_WINDOW_MS = 5_000;
export const BOSS_LABEL = 'boss';

/** Everything the model needs from one dashboard push. */
export interface CityInput {
  sessions: readonly SessionInfo[];
  messages: readonly MessageInfo[];
  subagents: readonly SubagentInfo[];
  nowMs: number;
}

/** A subagent drawn inside a shop. */
export interface CityWorker {
  agentId: string;
  agentType: string;
  activity: string;
}

/** One shop: a session, its state and the workers inside. `idleMs` is set only while `idle`. */
export interface CityShop {
  name: string;
  state: 'active' | 'idle' | 'stopped';
  idleMs: number | null;
  /** Stable slot; `column` and `row` are derived from it. */
  slot: number;
  column: number;
  row: number;
  workers: CityWorker[];
  /** Working subagents beyond `WORKERS_SHOWN_MAX`, drawn as "+N more". */
  moreWorkers: number;
}

/** A postman on the street (shop to shop) or inside one shop (worker to boss). */
export interface CityPostman {
  key: string;
  from: string;
  to: string;
  /** Set for a subagent hand-back: the shop it happens in. */
  insideShop: string | null;
  /** 0 at first sighting, 1 when it disappears. */
  progress: number;
}

/** The city at one moment. */
export interface City {
  shops: CityShop[];
  postmen: CityPostman[];
}

/** Keeps shop slots and first sightings across calls while the popup is open. */
export interface CityTracker {
  update(input: CityInput): City;
}

interface Trip {
  key: string;
  from: string;
  to: string;
  insideShop: string | null;
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

function buildPostmen(trips: readonly Trip[], shopNames: ReadonlySet<string>, nowMs: number): CityPostman[] {
  return trips
    .filter((trip) => (trip.insideShop ? shopNames.has(trip.insideShop) : shopNames.has(trip.from) && shopNames.has(trip.to)))
    .map((trip) => ({
      key: trip.key,
      from: trip.from,
      to: trip.to,
      insideShop: trip.insideShop,
      progress: Math.min(1, (nowMs - trip.firstSeenMs) / POSTMAN_LIFETIME_MS),
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

function shopState(isRunning: boolean, lastMessageMs: number | undefined, nowMs: number): 'active' | 'idle' | 'stopped' {
  if (!isRunning) return 'stopped';
  const isActive = lastMessageMs !== undefined && nowMs - lastMessageMs < ACTIVE_WINDOW_MS;
  return isActive ? 'active' : 'idle';
}

function workersOf(sessionId: string | undefined, subagents: readonly SubagentInfo[]): CityWorker[] {
  if (!sessionId) return [];
  return subagents
    .filter((subagent) => subagent.sessionId === sessionId && subagent.state === 'working')
    .map((subagent) => ({ agentId: subagent.agentId, agentType: subagent.agentType, activity: subagent.activity }));
}

class CityModel implements CityTracker {
  private readonly slotByName = new Map<string, number>();
  private readonly seen = new Map<string, SeenMessage>();
  private trips: Trip[] = [];
  private isFirstCall = true;

  update(input: CityInput): City {
    const { sessions, messages, subagents, nowMs } = input;
    this.sightMessages(messages, nowMs);
    this.isFirstCall = false;
    this.trips = this.trips.filter((trip) => nowMs - trip.firstSeenMs < POSTMAN_LIFETIME_MS);

    const latest = lastMessageTimes(messages);
    const runningByName = new Map(sessions.map((session) => [session.name, session]));
    const names = [...runningByName.keys()];
    for (const [name, lastMs] of latest) {
      if (!runningByName.has(name) && nowMs - lastMs < SHOP_RETENTION_MS) names.push(name);
    }
    this.assignSlots(names);

    const shops = names.map((name) => this.buildShop(name, runningByName.get(name), latest.get(name), subagents, nowMs));
    return { shops, postmen: buildPostmen(this.trips, new Set(names), nowMs) };
  }

  private assignSlots(names: readonly string[]): void {
    const present = new Set(names);
    for (const name of [...this.slotByName.keys()]) {
      if (!present.has(name)) this.slotByName.delete(name);
    }
    const taken = new Set(this.slotByName.values());
    for (const name of names) {
      if (this.slotByName.has(name)) continue;
      let slot = 0;
      while (taken.has(slot)) slot++;
      taken.add(slot);
      this.slotByName.set(name, slot);
    }
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
      const isNew = !this.isFirstCall || nowMs - message.tsMs < POSTMAN_LIFETIME_MS;
      if (isDuplicate || !isNew) continue;
      this.trips.push({ key, from, to, insideShop: isSubagent ? message.sessionName : null, firstSeenMs: nowMs });
    }
    for (const key of [...this.seen.keys()]) {
      if (!currentKeys.has(key)) this.seen.delete(key);
    }
  }

  private buildShop(
    name: string,
    session: SessionInfo | undefined,
    lastMessageMs: number | undefined,
    subagents: readonly SubagentInfo[],
    nowMs: number,
  ): CityShop {
    const state = shopState(session !== undefined, lastMessageMs, nowMs);
    const lastActivityMs = Math.max(lastMessageMs ?? 0, session?.updatedAtMs ?? 0);
    const workers = workersOf(session?.sessionId, subagents);
    const slot = this.slotByName.get(name) ?? 0;
    return {
      name,
      state,
      idleMs: state === 'idle' ? Math.max(0, nowMs - lastActivityMs) : null,
      slot,
      column: slot % SHOP_COLUMNS,
      row: Math.floor(slot / SHOP_COLUMNS),
      workers: workers.slice(0, WORKERS_SHOWN_MAX),
      moreWorkers: Math.max(0, workers.length - WORKERS_SHOWN_MAX),
    };
  }
}

/** Create a tracker; call `update` with every push while the popup is open, drop it when the popup closes. */
export function createCityTracker(): CityTracker {
  return new CityModel();
}
