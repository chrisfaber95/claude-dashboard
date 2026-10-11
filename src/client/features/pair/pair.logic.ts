import { isRecord } from '../../../shared/guards.ts';

export const PAIR_INVALID_TEXT = 'This QR code was already used or has expired. Ask for a new one.';
export const PAIR_RATE_LIMITED_TEXT = 'Too many attempts. Wait a minute and try again.';
export const PAIR_UNREACHABLE_TEXT = 'Could not reach the dashboard. Try again.';

const STATUS_RATE_LIMITED = 429;

/** The page's state as the server wrote it into the `data-state` attribute: only `ok` offers the button. */
export function isPairCodeValid(state: unknown): boolean {
  return state === 'ok';
}

/** True when the `POST /pair` body is the `{ ok: true }` the server sends for a spent, valid code. */
export function isPairSuccess(body: unknown): boolean {
  return isRecord(body) && body.ok === true;
}

/** The error text for a failed `POST /pair`, by HTTP status. */
export function pairFailureText(status: number): string {
  return status === STATUS_RATE_LIMITED ? PAIR_RATE_LIMITED_TEXT : PAIR_INVALID_TEXT;
}
