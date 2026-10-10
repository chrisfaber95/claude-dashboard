import { randomBytes } from 'node:crypto';

const PAIR_MS = 10 * 60_000;
const PAIR_MAX = 200;
const PAIR_CODE_MAX = 128;
const PAIR_CODE_BYTES = 32;

/** A pairing code waiting to be used. */
export interface Pairing {
  deviceId: string;
  expiresMs: number;
}

/** The unused single-use pairing codes, kept in memory only. */
export interface PairingStore {
  /** Make a code for the device; it replaces the device's earlier unused code. */
  create(deviceId: string, timeMs: number): { code: string; expiresMs: number };
  /** Look the code up without spending it. Undefined for an unknown or over-long code. */
  peek(code: string): Pairing | undefined;
  /** Look the code up and spend it, even when it turns out to be expired (single use). */
  take(code: string): Pairing | undefined;
  /** Forget every code of a device. */
  dropAllOf(deviceId: string): void;
  /** Forget codes that expired. */
  sweep(timeMs: number): void;
}

/** Creates the pairing code store. */
export function createPairingStore(): PairingStore {
  const pairings = new Map<string, Pairing>();
  const find = (code: string) => (typeof code === 'string' && code.length <= PAIR_CODE_MAX ? pairings.get(code) : undefined);
  const dropAllOf = (deviceId: string) => {
    for (const [code, pairing] of pairings) if (pairing.deviceId === deviceId) pairings.delete(code);
  };
  return {
    create(deviceId, timeMs) {
      dropAllOf(deviceId); // only the newest code of a device works
      if (pairings.size >= PAIR_MAX) {
        const oldest = pairings.keys().next().value;
        if (oldest !== undefined) pairings.delete(oldest);
      }
      const code = randomBytes(PAIR_CODE_BYTES).toString('base64url');
      const expiresMs = timeMs + PAIR_MS;
      pairings.set(code, { deviceId, expiresMs });
      return { code, expiresMs };
    },
    peek: find,
    take(code) {
      const pairing = find(code);
      if (pairing) pairings.delete(code);
      return pairing;
    },
    dropAllOf,
    sweep(timeMs) {
      for (const [code, pairing] of pairings) if (pairing.expiresMs < timeMs) pairings.delete(code);
    },
  };
}
