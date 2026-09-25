/**
 * Asset store: resolves generated art from assets/manifest.json and lazy-loads textures.
 * Small textures are packed into atlases (scripts/pack-atlas.ts): asking for one of them loads its whole
 * sheet once and registers every frame, so hundreds of icons cost a handful of requests.
 */
import { Assets, Texture, type Spritesheet } from 'pixi.js';

interface ManifestEntry { id: string; path: string; category: string }

class AssetStore {
  private byKey = new Map<string, string>(); // key (path w/o ext) -> url path
  private tex = new Map<string, Texture>();
  private pending = new Map<string, Promise<Texture | null>>();
  private atlasOf = new Map<string, string>(); // key -> atlas json path
  private sheets = new Map<string, Promise<void>>();
  entries: ManifestEntry[] = [];
  base = import.meta.env.BASE_URL ?? '/';

  async init() {
    try {
      const res = await fetch(`${this.base}manifest.json`, { cache: 'no-cache' });
      if (res.ok) {
        const m = (await res.json()) as { assets: ManifestEntry[] };
        this.entries = m.assets ?? [];
        for (const a of this.entries) this.byKey.set(a.path.replace(/\.[a-z0-9]+$/i, ''), a.path);
      }
    } catch { /* no manifest yet: everything falls back */ }
    try {
      const res = await fetch(`${this.base}atlas/index.json`, { cache: 'no-cache' });
      if (res.ok) for (const [k, v] of Object.entries((await res.json()) as Record<string, string>)) this.atlasOf.set(k, v);
    } catch { /* no atlases: every texture loads on its own */ }
  }

  has(key: string) { return this.byKey.has(key); }

  get(key: string): Texture | null { return this.tex.get(key) ?? null; }

  load(key: string): Promise<Texture | null> {
    const hit = this.tex.get(key);
    if (hit) return Promise.resolve(hit);
    const p = this.pending.get(key);
    if (p) return p;
    const path = this.byKey.get(key);
    if (!path) return Promise.resolve(null);
    const atlas = this.atlasOf.get(key);
    if (atlas) return this.loadSheet(atlas).then(() => this.tex.get(key) ?? (this.atlasOf.has(key) ? null : this.load(key)));
    const pr = Assets.load<Texture>({ alias: key, src: `${this.base}${path}` })
      .then((t) => { this.tex.set(key, t); return t; })
      .catch(() => null)
      .finally(() => this.pending.delete(key));
    this.pending.set(key, pr);
    return pr;
  }

  private loadSheet(json: string): Promise<void> {
    let p = this.sheets.get(json);
    if (!p) {
      p = Assets.load<Spritesheet>(`${this.base}${json}`)
        .then((sheet) => { for (const [k, t] of Object.entries(sheet.textures)) this.tex.set(k, t); })
        .catch(() => { for (const [k, v] of this.atlasOf) if (v === json) this.atlasOf.delete(k); }); // fall back to single files
      this.sheets.set(json, p);
    }
    return p;
  }

  loadMany(keys: string[], onProgress?: (k: number) => void): Promise<void> {
    const list = [...new Set(keys)].filter((k) => this.byKey.has(k) && !this.tex.has(k));
    if (!list.length) { onProgress?.(1); return Promise.resolve(); }
    let n = 0;
    return Promise.all(list.map((k) => this.load(k).then(() => onProgress?.(++n / list.length)))).then(() => undefined);
  }

  /** load and invoke cb (immediately if cached) */
  with(key: string, cb: (t: Texture) => void) {
    const t = this.tex.get(key);
    if (t) { cb(t); return; }
    void this.load(key).then((x) => { if (x) cb(x); });
  }

  keysByPrefix(prefix: string): string[] {
    return [...this.byKey.keys()].filter((k) => k.startsWith(prefix));
  }
}

export const assets = new AssetStore();

export const K = {
  card: (faction: string, id: string) => `cards/${faction}/${id}`,
  hero: (id: string) => `heroes/${id}`,
  enemy: (id: string, boss = false) => (boss ? `bosses/${id}` : `enemies/${id}`),
  relic: (id: string) => `ui/relics/${id}`,
  potion: (id: string) => `ui/potions/${id}`,
  icon: (id: string) => `ui/icons/${id}`,
  ui: (id: string) => `ui/${id}`,
  bg: (id: string) => `backgrounds/${id}`,
  event: (id: string) => `backgrounds/events/${id}`,
  fx: (id: string) => `effects/${id}`,
  emblem: (f: string) => `frames/emblem_${f}`,
};
