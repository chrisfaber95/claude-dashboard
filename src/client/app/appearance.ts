import { ensureRootScene } from '../skins/root-scene.ts';
import { parseSkin } from '../skins/skin.ts';
import type { Skin } from '../skins/skin.ts';
import { elementById } from '../shared/dom.ts';

const root = document.documentElement;

function applySkin(skin: Skin, skinSelect: HTMLSelectElement, themeButton: HTMLButtonElement): void {
  if (skin === 'classic') root.removeAttribute('data-skin');
  else root.setAttribute('data-skin', skin);
  skinSelect.value = skin;
  // Co-pilot and Root are dark only, so the light/dark toggle has nothing to do there.
  themeButton.hidden = skin === 'copilot' || skin === 'root';
  if (skin === 'root') ensureRootScene(); // builds the artwork once; other skins never load it
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage unavailable
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable; the choice only lasts for this page
  }
}

function initSkin(): void {
  const skinSelect = elementById<HTMLSelectElement>('skin');
  const themeButton = elementById<HTMLButtonElement>('theme');
  applySkin(parseSkin(readStored('skin')), skinSelect, themeButton);
  skinSelect.addEventListener('change', () => {
    const skin = parseSkin(skinSelect.value);
    applySkin(skin, skinSelect, themeButton);
    writeStored('skin', skin);
  });
}

function initTheme(): void {
  const saved = readStored('theme');
  if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved);
  elementById('theme').addEventListener('click', () => {
    const hasDarkTheme =
      root.getAttribute('data-theme') === 'dark' || (!root.hasAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
    const next = hasDarkTheme ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    writeStored('theme', next);
  });
}

/** Apply the saved skin and theme and wire the header pickers. */
export function initAppearance(): void {
  initSkin();
  initTheme();
}
