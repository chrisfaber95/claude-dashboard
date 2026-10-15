// Thin adapter: the old city shapes (shops, postmen on a 4-column grid) on top of the kingdom model,
// until the kingdom view (T-099) replaces the city view.
import { BOSS_LABEL, CASTLE_ID, MAILMAN_LIFETIME_MS, WORKERS_SHOWN_MAX, createKingdomTracker } from './kingdom.logic.ts';
import type { Kingdom, KingdomBuilding, KingdomInput, KingdomWorker } from './kingdom.logic.ts';

export { BOSS_LABEL, WORKERS_SHOWN_MAX };
export const POSTMAN_LIFETIME_MS = MAILMAN_LIFETIME_MS;
export const SHOP_COLUMNS = 4;

/** What the city view needs from one push; alerts and permissions do not show in the city. */
export type CityInput = Pick<KingdomInput, 'sessions' | 'messages' | 'subagents' | 'nowMs'>;

/** A subagent drawn inside a shop. */
export type CityWorker = KingdomWorker;

/** One shop: a building with a grid cell derived from its position on screen. */
export interface CityShop extends Omit<KingdomBuilding, 'kind' | 'areaId'> {
  column: number;
  row: number;
}

/** A postman on the street (shop to shop) or inside one shop (worker to boss). */
export interface CityPostman {
  key: string;
  from: string;
  to: string;
  insideShop: string | null;
  progress: number;
}

/** The city at one moment. */
export interface City {
  shops: CityShop[];
  postmen: CityPostman[];
}

/** Keeps the kingdom state across calls while the popup is open. */
export interface CityTracker {
  update(input: CityInput): City;
}

function toCity(kingdom: Kingdom): City {
  const buildings = kingdom.areas.flatMap((area) => area.buildings);
  const shops = buildings.map((building, index) => ({
    name: building.name,
    state: building.state,
    idleMs: building.idleMs,
    slot: index,
    column: index % SHOP_COLUMNS,
    row: Math.floor(index / SHOP_COLUMNS),
    workers: building.workers,
    moreWorkers: building.moreWorkers,
  }));
  const postmen = kingdom.mailmen
    .filter((mailman) => mailman.to !== CASTLE_ID)
    .map((mailman) => ({
      key: mailman.key,
      from: mailman.from,
      to: mailman.to,
      insideShop: mailman.insideBuilding,
      progress: mailman.progress,
    }));
  return { shops, postmen };
}

/** Create a tracker; call `update` with every push while the popup is open, drop it when the popup closes. */
export function createCityTracker(): CityTracker {
  const kingdom = createKingdomTracker();
  return { update: (input) => toCity(kingdom.update({ ...input, alerts: [], permissions: [] })) };
}
