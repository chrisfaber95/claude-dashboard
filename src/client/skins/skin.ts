// Skin names (no DOM): app.ts reads and writes the stored choice.
/** Name of one UI skin. */
export type Skin = 'classic' | 'copilot' | 'root';

/** Every skin, in menu order. */
export const SKINS: readonly Skin[] = ['classic', 'copilot', 'root'];

/** Validate a stored skin name; anything unknown is classic. */
export function parseSkin(value: string | null | undefined): Skin {
  return SKINS.find((skin) => skin === value) ?? 'classic';
}
