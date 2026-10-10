// Runs from <head> before first paint: applies the saved skin and theme so the page does not flash.
import { parseSkin } from '../skins/skin.ts';

try {
  const root = document.documentElement;
  const skin = parseSkin(localStorage.getItem('skin'));
  if (skin !== 'classic') root.setAttribute('data-skin', skin);
  const theme = localStorage.getItem('theme');
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
} catch {
  // storage unavailable; defaults apply
}
