/**
 * Rebuild guards for views that redraw from game state: a view rebuilds only when the data it shows changed,
 * so a sync after every action no longer re-creates texts / sprites that would look identical.
 */
const last = new WeakMap<object, Map<string, string>>();

/** true when `key` equals what this owner/slot last rendered (then skip the rebuild) */
export function unchanged(owner: object, slot: string, key: unknown): boolean {
  const k = JSON.stringify(key);
  let m = last.get(owner);
  if (!m) { m = new Map(); last.set(owner, m); }
  if (m.get(slot) === k) return true;
  m.set(slot, k);
  return false;
}

/** remove and destroy every child (removeChildren alone leaks GPU textures of generated text) */
export function clearChildren(c: { removeChildren(): { destroy(o?: { children: boolean }): void }[] }) {
  for (const x of c.removeChildren()) x.destroy({ children: true });
}
