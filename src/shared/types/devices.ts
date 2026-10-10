/** A LAN device as listed by `GET /api/devices`. Never carries the token or its hash. */
export interface DeviceInfo {
  id: string;
  name: string;
  createdMs: number;
  lastSeenMs: number | null;
}

/** Answer of `POST /api/devices/pair`: a single-use pairing link. Never contains the device token. */
export interface PairingInfo {
  /** `/pair?c=<code>`, relative to the dashboard. */
  path: string;
  /** The same link on each LAN address of this PC (what a phone can open). Empty when none was found. */
  urls: string[];
  /** When the code stops working. */
  expiresMs: number;
}
