import { computed, ref, watchEffect } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import { ensureRootScene } from '../skins/root-scene.ts';
import { parseSkin } from '../skins/skin.ts';
import type { Skin } from '../skins/skin.ts';

const root = document.documentElement;

/** The skin and theme choices of the header pickers. */
export interface Appearance {
  skin: Readonly<Ref<Skin>>;
  /** Co-pilot and Root are dark only, so the light/dark toggle has nothing to do there. */
  isThemeToggleHidden: ComputedRef<boolean>;
  chooseSkin: (name: string) => void;
  toggleTheme: () => void;
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

function applySkin(skin: Skin): void {
  if (skin === 'classic') root.removeAttribute('data-skin');
  else root.setAttribute('data-skin', skin);
  if (skin === 'root') ensureRootScene(); // builds the artwork once; other skins never load it
}

function isDarkTheme(): boolean {
  if (root.getAttribute('data-theme') === 'dark') return true;
  return !root.hasAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Apply the saved skin and theme and return the handlers of the header pickers. Call once, from the app root. */
export function useAppearance(): Appearance {
  const skin = ref<Skin>(parseSkin(readStored('skin')));
  const savedTheme = readStored('theme');
  if (savedTheme === 'light' || savedTheme === 'dark') root.setAttribute('data-theme', savedTheme);

  // post: the Root scene looks for the core strip in the page, which exists only after the first mount.
  watchEffect(() => applySkin(skin.value), { flush: 'post' });

  return {
    skin,
    isThemeToggleHidden: computed(() => skin.value === 'copilot' || skin.value === 'root'),
    chooseSkin(name) {
      skin.value = parseSkin(name);
      writeStored('skin', skin.value);
    },
    toggleTheme() {
      const next = isDarkTheme() ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      writeStored('theme', next);
    },
  };
}
