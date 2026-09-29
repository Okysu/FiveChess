/**
 * Asset store: resolves generated art from assets/manifest.json and lazy-loads textures.
 * Small textures are packed into atlases (scripts/pack-atlas.ts): asking for one of them loads its whole
 * sheet once and registers every frame, so hundreds of icons cost a handful of requests.
 */
import { Assets, Texture, type Spritesheet } from 'pixi.js';
import { content } from '../engine/content';

interface ManifestEntry { id: string; path: string; category: string }

class AssetStore {
  private byKey = new Map<string, string>(); // key (path w/o ext) -> url path
  private tex = new Map<string, Texture>();
  private pending = new Map<string, Promise<Texture | null>>();
  private atlasOf = new Map<string, string>(); // key -> atlas json path
  private sheets = new Map<string, Promise<void>>();
  /** keys (and atlas names) that also exist as .avif, used when the browser decodes AVIF (scripts/optimize-images.ts) */
  private avif = new Set<string>();
  private avifOk = false;
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
    const [list, ok] = await Promise.all([
      fetch(`${this.base}avif.json`, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() as Promise<string[]> : [])).catch(() => [] as string[]),
      supportsAvif(),
    ]);
    this.avifOk = ok;
    for (const k of list) this.avif.add(k);
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
    const file = this.avifOk && this.avif.has(key) ? path.replace(/\.webp$/, '.avif') : path;
    const pr = Assets.load<Texture>({ alias: key, src: `${this.base}${file}` })
      .then((t) => { this.tex.set(key, t); return t; })
      .catch(() => null)
      .finally(() => this.pending.delete(key));
    this.pending.set(key, pr);
    return pr;
  }

  private loadSheet(json: string): Promise<void> {
    let p = this.sheets.get(json);
    if (!p) {
      // the AVIF twin of an atlas has its own json whose meta.image points at the .avif sheet
      const name = json.replace(/\.json$/, '');
      const src = this.avifOk && this.avif.has(name) ? `${name}.avif.json` : json;
      p = Assets.load<Spritesheet>(`${this.base}${src}`)
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

  /** the URL a texture key loads from (its atlas sheet image, or the AVIF/WebP file) — used by prefetch */
  urlOf(key: string): string | null {
    const atlas = this.atlasOf.get(key);
    if (atlas) {
      const name = atlas.replace(/.json$/, '');
      return `${this.base}${name}.${this.avifOk && this.avif.has(name) ? 'avif' : 'webp'}`;
    }
    const path = this.byKey.get(key);
    if (!path) return null;
    return `${this.base}${this.avifOk && this.avif.has(key) ? path.replace(/.webp$/, '.avif') : path}`;
  }

  keysByPrefix(prefix: string): string[] {
    return [...this.byKey.keys()].filter((k) => k.startsWith(prefix));
  }
}

/** true when the browser decodes AVIF (a 1×1 image) */
function supportsAvif(): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.width > 0);
    img.onerror = () => resolve(false);
    img.src = 'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQ0MAAAAABNjb2xybmNseAACAAIAAYAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgANogQEAwgMg8f8D///8WfhwB8+ErK42A=';
  });
}

export const assets = new AssetStore();

export const K = {
  card: (faction: string, id: string) => `cards/${faction}/${id}`,
  hero: (id: string) => `heroes/${id}`,
  enemy: (id: string, boss = false) => (boss ? `bosses/${id}` : `enemies/${id}`),
  /** the art an enemy is drawn with: a shadow of a commander (迷途执命者) wears that commander's portrait */
  enemyArt: (id: string) => {
    const e = content().enemies.get(id);
    if (e?.commander) return `heroes/${e.commander}`;
    return e?.tier === 'boss' ? `bosses/${id}` : `enemies/${id}`;
  },
  relic: (id: string) => `ui/relics/${id}`,
  potion: (id: string) => `ui/potions/${id}`,
  icon: (id: string) => `ui/icons/${id}`,
  ui: (id: string) => `ui/${id}`,
  bg: (id: string) => `backgrounds/${id}`,
  event: (id: string) => `backgrounds/events/${id}`,
  fx: (id: string) => `effects/${id}`,
  emblem: (f: string) => `frames/emblem_${f}`,
};
