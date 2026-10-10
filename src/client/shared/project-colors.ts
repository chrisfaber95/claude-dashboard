const SLOT_COUNT = 8;
const FIRST_SLOT = 1;

// Null until the first state arrives; every project then shows the first slot.
let slotOfProject: Map<string, number> | null = null;

function slotFor(name: string): number {
  if (!slotOfProject) return FIRST_SLOT;
  return slotOfProject.get(name) ?? 0;
}

/** Project colour follows the project (alphabetical, fixed order), never its rank. */
export function setProjectColors(names: string[]): void {
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  slotOfProject = new Map(sorted.slice(0, SLOT_COUNT).map((name, index) => [name, index + 1]));
}

/** CSS colour of a project; muted when it has no slot. */
export function projectColor(name: string): string {
  const slot = slotFor(name);
  return slot ? `var(--s${slot})` : 'var(--muted)';
}

/** Tint class of a project, same slot as its colour. */
export function projectTint(name: string): string {
  const slot = slotFor(name);
  return slot ? `tint-${slot}` : 'tint-muted';
}
