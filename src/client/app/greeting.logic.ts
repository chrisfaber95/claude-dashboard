// Skin-aware greeting for the header (pure, no DOM).
import { parseSkin } from '../skins/skin.ts';
import type { Skin } from '../skins/skin.ts';

/** Part of the day, from the local time. */
export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

const MORNING_START_HOUR = 5;
const AFTERNOON_START_HOUR = 12;
const EVENING_START_HOUR = 18;
const NIGHT_START_HOUR = 22;

const GREETINGS = {
  classic: {
    morning: 'Good morning.',
    afternoon: 'Good afternoon.',
    evening: 'Good evening.',
    night: 'Good night.',
  },
  copilot: {
    morning: 'Good morning, driver. Systems online, route clear.',
    afternoon: 'Good afternoon, driver. Cruising speed holds steady.',
    evening: 'Good evening, driver. Headlights on, scanner active.',
    night: 'Night mode engaged, driver. I will keep watch.',
  },
  root: {
    morning: 'Morning light reaches the canopy.',
    afternoon: 'The afternoon sun warms the forest floor.',
    evening: 'Dusk settles between the trees.',
    night: 'The forest sleeps under the stars.',
  },
} as const satisfies Record<Skin, Record<TimeOfDay, string>>;

/** The part of the day of a Date, in local time. */
export function getTimeOfDay(date: Date): TimeOfDay {
  const hour = date.getHours();
  if (hour >= NIGHT_START_HOUR || hour < MORNING_START_HOUR) return 'night';
  if (hour < AFTERNOON_START_HOUR) return 'morning';
  if (hour < EVENING_START_HOUR) return 'afternoon';
  return 'evening';
}

/** Greeting for a skin at the local time of a Date; an unknown or missing skin gets the classic wording. */
export function getGreeting(skin: string | null | undefined, date: Date): string {
  return GREETINGS[parseSkin(skin)][getTimeOfDay(date)];
}
