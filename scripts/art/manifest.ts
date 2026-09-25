/** Shared manifest + cache-hash helpers for generate.ts and atlas.ts (merge-on-save: parallel runs are safe). */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { ArtJob } from './jobs';

export const ASSETS = 'assets';
export const MANIFEST = path.join(ASSETS, 'manifest.json');

export interface ManifestEntry {
  id: string; path: string; category: string; source_type: 'ai_generated' | 'free_asset' | 'edited_free_asset' | 'procedural';
  source: string; license: string; prompt?: string; reference?: string; postprocess: string; hash?: string; qa?: string;
}

/** cache key: a job regenerates only when what it asks for changes (not when the model does) */
export const jobHash = (j: ArtJob) => crypto.createHash('sha1').update(`${j.prompt}|${j.size}|${j.transparent}|${j.ref ?? ''}|${j.px}`).digest('hex').slice(0, 12);
export const outFile = (j: ArtJob) => `${j.out}.webp`;

export function openManifest() {
  const manifest: { generated: string; assets: ManifestEntry[] } = fs.existsSync(MANIFEST)
    ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : { generated: '', assets: [] };
  const byPath = new Map(manifest.assets.map((a) => [a.path, a]));
  const isDone = (j: ArtJob) => {
    const m = byPath.get(outFile(j));
    return fs.existsSync(path.join(ASSETS, outFile(j))) && !!m && m.hash === jobHash(j);
  };
  const save = () => {
    try {
      const disk = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) as typeof manifest;
      for (const a of disk.assets ?? []) if (!byPath.has(a.path)) byPath.set(a.path, a);
    } catch { /* first write */ }
    manifest.generated = new Date().toISOString();
    manifest.assets = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
  };
  return { byPath, isDone, save };
}

export const modelSource = (model: string) => `${model} via hjmai.yby.zone (project key)`;
