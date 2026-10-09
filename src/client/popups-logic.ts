import type { UsageDay } from '../shared/types.ts';

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
] as const;

export type PopupId = (typeof POPUPS)[number]['id'];

/** Buttons for sections that are hidden today (no board, devices or commands not allowed) stay hidden. */
export function visiblePopups(sectionHidden: (id: PopupId) => boolean): PopupId[] {
  return POPUPS.map((p) => p.id).filter((id) => !sectionHidden(id));
}

/** A section that lives in a popup is drawn only while that popup is open; everything else always. */
export function drawsSection(id: string, current: PopupId | null): boolean {
  return !POPUPS.some((p) => p.id === id) || current === id;
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

export function localDayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Today's total tokens (all four kinds) from the usage days. */
export function tokensToday(days: readonly UsageDay[], now: Date): number {
  const d = days.find((x) => x.day === localDayKey(now));
  return d ? d.tokens.input + d.tokens.output + d.tokens.cacheRead + d.tokens.cacheWrite : 0;
}
