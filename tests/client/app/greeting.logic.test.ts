// Greeting per skin and time of day, including the boundaries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getGreeting } from '../../../src/client/app/greeting.logic.ts';
import { SKINS } from '../../../src/client/skins/skin.ts';

function at(hour: number, minute: number): Date {
  return new Date(2026, 9, 30, hour, minute);
}

const BOUNDARIES = [
  { hour: 4, minute: 59, part: 'night' },
  { hour: 5, minute: 0, part: 'morning' },
  { hour: 11, minute: 59, part: 'morning' },
  { hour: 12, minute: 0, part: 'afternoon' },
  { hour: 17, minute: 59, part: 'afternoon' },
  { hour: 18, minute: 0, part: 'evening' },
  { hour: 21, minute: 59, part: 'evening' },
  { hour: 22, minute: 0, part: 'night' },
] as const;

test('each skin gives the same text within a part of the day and a different text across parts', () => {
  for (const skin of SKINS) {
    const byPart = new Map<string, string>();
    for (const { hour, minute, part } of BOUNDARIES) {
      const text = getGreeting(skin, at(hour, minute));
      assert.ok(text.length > 0, `${skin} ${hour}:${minute}`);
      assert.equal(byPart.get(part) ?? text, text, `${skin} ${hour}:${minute} stays ${part}`);
      byPart.set(part, text);
    }
    assert.equal(new Set(byPart.values()).size, 4, `${skin} has four distinct parts`);
  }
});

test('the three skins differ at every boundary time', () => {
  for (const { hour, minute } of BOUNDARIES) {
    const texts = SKINS.map((skin) => getGreeting(skin, at(hour, minute)));
    assert.equal(new Set(texts).size, SKINS.length, `${hour}:${minute}`);
  }
});

test('an unknown or missing skin falls back to the classic wording', () => {
  for (const { hour, minute } of BOUNDARIES) {
    const classic = getGreeting('classic', at(hour, minute));
    for (const skin of [undefined, null, '', 'nope', 'Copilot']) {
      assert.equal(getGreeting(skin, at(hour, minute)), classic, `${String(skin)} ${hour}:${minute}`);
    }
  }
});
