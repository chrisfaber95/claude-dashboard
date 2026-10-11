import type { UsageDay } from '../../../shared/types/index.ts';

/** Fixed set and order of the popup buttons; not user-arrangeable. */
export const POPUPS = [
  { id: 'projects', label: 'Projects' },
  { id: 'comms', label: 'Session messages' },
  { id: 'team', label: 'Team board' },
  { id: 'usage', label: 'Token usage (14 days)' },
  { id: 'chat', label: 'Chat' },
  { id: 'run', label: 'Launch a task' },
  { id: 'devices', label: 'Devices' },
  { id: 'audit', label: 'Activity' },
  { id: 'approvals', label: 'Approvals' },
] as const;

/** Id of one popup. */
export type PopupId = (typeof POPUPS)[number]['id'];

/** What decides which popup buttons exist: the team board, whether commands are allowed, and whether this is the PC. */
export interface PopupAvailability {
  hasTeamBoard: boolean;
  canRunCommands: boolean;
  canManageDevices: boolean;
}

/** Every popup is always available except the team board, the command popups (run, approvals) and devices. */
export function isPopupAvailable(id: PopupId, availability: PopupAvailability): boolean {
  if (id === 'team') return availability.hasTeamBoard;
  if (id === 'run' || id === 'approvals') return availability.canRunCommands;
  if (id === 'devices') return availability.canManageDevices;
  return true;
}

/** Popup ids whose button shows, in button order. */
export function visiblePopups(availability: PopupAvailability): PopupId[] {
  return POPUPS.map((popup) => popup.id).filter((id) => isPopupAvailable(id, availability));
}

/** Narrow an unknown value (a dataset entry) to a popup id. */
export function isPopupId(value: unknown): value is PopupId {
  return POPUPS.some((popup) => popup.id === value);
}

/** A section that lives in a popup is drawn only while that popup is open; everything else always. */
export function drawsSection(id: string, current: PopupId | null): boolean {
  return !POPUPS.some((popup) => popup.id === id) || current === id;
}

/** Opening reveals the popup first (so its section counts as drawn), then renders it from the latest state. */
export function openPopup(id: PopupId, reveal: (id: PopupId) => void, render: (id: PopupId) => void): void {
  reveal(id);
  render(id);
}

/** One popup at a time: opening another replaces the current one, its own button toggles it shut. */
export function toggled(current: PopupId | null, requested: PopupId): PopupId | null {
  return current === requested ? null : requested;
}

/** A popup whose section went away (board removed, devices no longer allowed) closes by itself. */
export function stillOpen(current: PopupId | null, visible: readonly PopupId[]): PopupId | null {
  return current && visible.includes(current) ? current : null;
}

/** Esc closes the popup only when nothing stacked above it (building dialog, transcript drawer) is open. */
export function escapeClosesPopup(key: string, current: PopupId | null, aboveOpen: boolean): boolean {
  return key === 'Escape' && current !== null && !aboveOpen;
}

/** The backdrop itself, not a click that started or landed inside the panel, closes the popup. */
export function backdropCloses(target: unknown, backdrop: unknown): boolean {
  return target === backdrop;
}

/** Local calendar day as YYYY-MM-DD, the key of a usage day. */
export function localDayKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Today's total tokens (all four kinds) from the usage days. */
export function tokensToday(days: readonly UsageDay[], now: Date): number {
  const today = days.find((entry) => entry.day === localDayKey(now));
  return today ? today.tokens.input + today.tokens.output + today.tokens.cacheRead + today.tokens.cacheWrite : 0;
}
