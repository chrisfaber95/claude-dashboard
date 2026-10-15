// Pure geometry of the message city (no DOM): where shops, workers and postmen are drawn in SVG units.
import type { CityPostman, CityShop } from './city.logic.ts';
import { BOSS_LABEL, SHOP_COLUMNS } from './city.logic.ts';

export const COLUMN_WIDTH = 100;
export const ROW_HEIGHT = 112;
export const CITY_WIDTH = COLUMN_WIDTH * SHOP_COLUMNS;
export const SHOP_WIDTH = 88;
export const AWNING_HEIGHT = 14;
export const BODY_HEIGHT = 60;
const SHOP_MARGIN_X = 6;
const SHOP_MARGIN_Y = 4;
const WORKERS_PER_ROW = 3;
const WORKER_SPACING = 16;
const NAME_LABEL_MAX = 14;
const MINUTE_MS = 60_000;
const SECOND_MS = 1000;

/** A point in city coordinates. */
export interface CityPoint {
  x: number;
  y: number;
}

/** Start and end of one postman's walk. */
export interface PostmanPath {
  from: CityPoint;
  to: CityPoint;
}

type ShopCell = Pick<CityShop, 'column' | 'row'>;

/** Top-left corner of a shop's awning. */
export function shopOrigin(shop: ShopCell): CityPoint {
  return { x: shop.column * COLUMN_WIDTH + SHOP_MARGIN_X, y: shop.row * ROW_HEIGHT + SHOP_MARGIN_Y };
}

/** Height of the whole city SVG: at least one row of shops. */
export function cityHeight(shops: readonly Pick<CityShop, 'row'>[]): number {
  const rows = shops.reduce((most, shop) => Math.max(most, shop.row + 1), 1);
  return rows * ROW_HEIGHT;
}

/** The street-side door of a shop, where postmen leave and arrive. */
export function doorPoint(shop: ShopCell): CityPoint {
  const origin = shopOrigin(shop);
  return { x: origin.x + SHOP_WIDTH / 2, y: origin.y + AWNING_HEIGHT + BODY_HEIGHT };
}

/** Where the session itself (the boss) stands inside its shop. */
export function bossPoint(shop: ShopCell): CityPoint {
  const origin = shopOrigin(shop);
  return { x: origin.x + 14, y: origin.y + AWNING_HEIGHT + 20 };
}

/** Where the worker with this list index stands inside its shop. */
export function workerPoint(shop: ShopCell, index: number): CityPoint {
  const origin = shopOrigin(shop);
  return {
    x: origin.x + 34 + (index % WORKERS_PER_ROW) * WORKER_SPACING,
    y: origin.y + AWNING_HEIGHT + 16 + Math.floor(index / WORKERS_PER_ROW) * WORKER_SPACING,
  };
}

/** Walk of one postman, or null when its shop is not on screen. */
export function postmanPath(postman: CityPostman, shops: readonly CityShop[]): PostmanPath | null {
  if (postman.insideShop !== null) {
    const shop = shops.find((candidate) => candidate.name === postman.insideShop);
    if (!shop) return null;
    const workerIndex = shop.workers.findIndex((worker) => worker.agentId === postman.from);
    const from = workerPoint(shop, Math.max(0, workerIndex));
    return { from, to: postman.to === BOSS_LABEL ? bossPoint(shop) : from };
  }
  const sender = shops.find((candidate) => candidate.name === postman.from);
  const receiver = shops.find((candidate) => candidate.name === postman.to);
  if (!sender || !receiver) return null;
  return { from: doorPoint(sender), to: doorPoint(receiver) };
}

/** Shop name shortened to fit under the shop. */
export function shopNameLabel(name: string): string {
  return name.length > NAME_LABEL_MAX ? `${name.slice(0, NAME_LABEL_MAX - 1)}…` : name;
}

/** "active", "idle 12 min" or "stopped". */
export function shopStatusLabel(shop: Pick<CityShop, 'state' | 'idleMs'>): string {
  if (shop.state === 'stopped') return 'stopped';
  if (shop.state === 'active' || shop.idleMs === null) return 'active';
  if (shop.idleMs < MINUTE_MS) return `idle ${Math.floor(shop.idleMs / SECOND_MS)} s`;
  return `idle ${Math.floor(shop.idleMs / MINUTE_MS)} min`;
}
