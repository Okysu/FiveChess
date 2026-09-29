/** The game version: package.json "version", injected by Vite (vite.config.ts `define`). One source for web, PC and Android. */
import changelog from '../data/changelog.json';

declare const __APP_VERSION__: string;
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';

export interface ChangeEntry { text: string; platforms?: ('web' | 'pc' | 'android')[] }
export interface VersionLog { version: string; date: string; title: string; sections: Record<string, ChangeEntry[]> }
export const CHANGELOG: VersionLog[] = (changelog as unknown as { versions: VersionLog[] }).versions;

/** -1 / 0 / 1 for dotted numeric versions */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0), pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] ?? 0) - (pb[i] ?? 0); if (d) return d < 0 ? -1 : 1; }
  return 0;
}

/** versions newer than `seen` up to the running one, newest first */
export function logsSince(seen: string | null): VersionLog[] {
  return CHANGELOG.filter((v) => compareVersions(v.version, APP_VERSION) <= 0 && (!seen || compareVersions(v.version, seen) > 0));
}
