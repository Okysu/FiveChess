/**
 * Layout profile: 'desktop' (the 1920×1080 design as authored) or 'phone' (same design space, but a phone
 * shows it at ~0.35× — so text and touch targets are enlarged and combat uses its own geometry).
 * The profile is chosen from the viewport and fixed for the lifetime of a scene; a change rebuilds the scene.
 */
export type Profile = 'desktop' | 'phone';

let current: Profile = 'desktop';
export const profile = () => current;
export const isPhone = () => current === 'phone';

/** decide the profile from the landscape viewport (after the portrait rotation) */
export function pickProfile(viewW: number, viewH: number): Profile {
  // the design is 1920×1080; below ~0.55× scale text drops under ~12 css px
  return Math.min(viewW / 1920, viewH / 1080) < 0.55 ? 'phone' : 'desktop';
}
export function setProfile(p: Profile): boolean { const changed = p !== current; current = p; return changed; }

/**
 * Font size for the active profile. Small text grows the most on phones; big titles stay as they are.
 * Every UI font size goes through here (cards / unit badges / fate cards scale as whole components instead).
 */
export function fs(n: number): number {
  if (current === 'desktop') return n;
  const k = n <= 16 ? 1.6 : n <= 22 ? 1.45 : n <= 30 ? 1.3 : n <= 44 ? 1.15 : 1;
  return Math.round(n * k);
}
