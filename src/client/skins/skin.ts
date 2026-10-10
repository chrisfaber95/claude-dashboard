// Skin names (no DOM): app.ts reads and writes the stored choice.
export type Skin = 'classic' | 'copilot' | 'root';

export const SKINS: readonly Skin[] = ['classic', 'copilot', 'root'];

export function parseSkin(v: string | null | undefined): Skin {
  return SKINS.find((s) => s === v) ?? 'classic';
}
