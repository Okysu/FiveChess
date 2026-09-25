/**
 * Batch art generation.
 *   npm run gen:art -- [--only=card,enemy,...] [--ids=r_,e1_] [--limit=N] [--concurrency=6] [--force] [--dry]
 * Reads content data (art.subject) + static job lists, calls the image API (edits with a style ref),
 * post-processes (chroma-key fallback, resize, webp), writes assets/manifest.json and a log.
 * Build-time only; the API key is read from .env and never bundled.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { generate } from './api';
import { CUTOUT_MAGENTA } from './style';
import type { ArtJob } from './jobs';
import { buildJobs } from './alljobs';

const ASSETS = 'assets';
const RAW = '.cache/art_raw';
const LOG = '.cache/art/gen.log';
const MANIFEST = path.join(ASSETS, 'manifest.json');

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k!, v ?? 'true']; }));
const only = args.only ? new Set(args.only.split(',')) : null;
const idPrefixes = args.ids ? args.ids.split(',') : null;
const limit = args.limit ? Number(args.limit) : Infinity;
const concurrency = Number(args.concurrency ?? 6);
const force = args.force === 'true';
const dry = args.dry === 'true';
const qualityOverride = args.quality as ArtJob['quality'] | undefined;

fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(path.dirname(LOG), { recursive: true });
const log = (s: string) => { const line = `[${new Date().toISOString()}] ${s}`; console.log(line); fs.appendFileSync(LOG, line + '\n'); };

interface ManifestEntry {
  id: string; path: string; category: string; source_type: 'ai_generated' | 'free_asset' | 'edited_free_asset' | 'procedural';
  source: string; license: string; prompt?: string; reference?: string; postprocess: string; hash?: string; qa?: string;
}
const manifest: { generated: string; assets: ManifestEntry[] } = fs.existsSync(MANIFEST)
  ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : { generated: '', assets: [] };
const byPath = new Map(manifest.assets.map((a) => [a.path, a]));

const jobs = buildJobs();

// ───────────── filter ─────────────
const hash = (j: ArtJob) => crypto.createHash('sha1').update(`${j.prompt}|${j.size}|${j.transparent}|${j.ref ?? ''}|${j.px}`).digest('hex').slice(0, 12);
const outFile = (j: ArtJob) => `${j.out}.webp`;

let todo = jobs.filter((j) => (!only || only.has(j.category)) && (!idPrefixes || idPrefixes.some((p) => j.id.startsWith(p))));
todo = todo.filter((j) => {
  if (force) return true;
  const f = path.join(ASSETS, outFile(j));
  const m = byPath.get(outFile(j));
  return !(fs.existsSync(f) && m && m.hash === hash(j));
});
todo = todo.slice(0, limit);
log(`jobs total=${jobs.length} todo=${todo.length} concurrency=${concurrency}${dry ? ' (dry)' : ''}`);
if (dry) { for (const j of todo.slice(0, 40)) console.log(j.category, j.id, j.size, j.transparent ? 'alpha' : ''); process.exit(0); }

// ───────────── post-processing ─────────────
async function alphaStats(buf: Buffer) {
  const img = sharp(buf).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  let opaque = 0, border = 0, borderOpaque = 0;
  const w = info.width, h = info.height;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = data[(y * w + x) * 4 + 3]!;
    if (a > 128) opaque++;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { border++; if (a > 128) borderOpaque++; }
  }
  return { coverage: opaque / (w * h), edge: borderOpaque / border };
}

/** magenta (or cyan) chroma key with despill and 1px feather */
async function chromaKey(buf: Buffer, key: [number, number, number]): Promise<Buffer> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const [kr, kg, kb] = key;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
    const d = Math.sqrt((r - kr) ** 2 + (g - kg) ** 2 + (b - kb) ** 2);
    let a = d < 60 ? 0 : d < 140 ? Math.round(((d - 60) / 80) * 255) : 255;
    if (a < 255 && a > 0) {
      // despill: pull the key hue out of semi-transparent edge pixels
      if (kr > 200 && kb > 200) { const m = Math.min(r, b); data[i] = Math.max(0, r - (m - g) * 0.8); data[i + 2] = Math.max(0, b - (m - g) * 0.8); }
      else { const m = Math.min(g, b); data[i + 1] = Math.max(0, g - (m - r) * 0.8); data[i + 2] = Math.max(0, b - (m - r) * 0.8); }
    }
    data[i + 3] = Math.min(data[i + 3]!, a);
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

async function finish(j: ArtJob, raw: Buffer): Promise<{ post: string; qa: string }> {
  const dest = path.join(ASSETS, outFile(j));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let img = raw;
  const post: string[] = [];
  let qa = 'ok';
  if (j.transparent) {
    const st = await alphaStats(img);
    if (st.coverage > 0.97) {
      // background came back opaque → chroma-key fallback happened upstream; flag
      qa = 'opaque-background';
    }
    if (st.edge > 0.08) qa = qa === 'ok' ? `touches-edge(${st.edge.toFixed(2)})` : qa;
    if (j.magentaSubject) post.push('chroma-key');
    // trim transparent margins, keep a small pad
    img = await sharp(img).trim({ threshold: 1 }).extend({ top: 8, bottom: 8, left: 8, right: 8, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    post.push('trimmed');
  }
  const meta = await sharp(img).metadata();
  const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
  const pipeline = sharp(img).resize({ width: meta.width! >= meta.height! ? Math.min(j.px, longEdge) : undefined, height: meta.height! > meta.width! ? Math.min(j.px, longEdge) : undefined, fit: 'inside' });
  await pipeline.webp({ quality: j.category === 'background' || j.category === 'event' ? 82 : 86, alphaQuality: 90, effort: 5 }).toFile(dest);
  post.push(`resized≤${j.px}px`, 'webp');
  return { post: post.join(', '), qa };
}

async function runJob(j: ArtJob) {
  const rawPath = path.join(RAW, `${j.out.replace(/\//g, '__')}.png`);
  const quality = qualityOverride ?? j.quality ?? 'medium';
  let raw: Buffer | null = null;
  let magenta = false;
  for (let attempt = 0; attempt <= 2 && !raw; attempt++) {
    try {
      const t = Date.now();
      const refUsable = j.ref && fs.existsSync(j.ref);
      const prompt = refUsable
        ? `Create a completely new illustration in exactly the same painting style, brushwork and lighting as the reference image, with an entirely different subject and composition. ${j.prompt}`
        : j.prompt;
      raw = await generate({ prompt, size: j.size, quality, transparent: j.transparent, ref: refUsable ? j.ref : undefined });
      if (j.transparent) {
        const st = await alphaStats(raw);
        if (st.coverage > 0.97) {
          // transparency ignored → regenerate on magenta and key it out
          log(`${j.id}: opaque result, retrying with magenta key`);
          const kp = j.prompt.replace(/isolated[^.]*transparent background[^.]*\./gi, '') + ' ' + CUTOUT_MAGENTA;
          const m = await generate({ prompt: kp, size: j.size, quality, transparent: false });
          raw = await chromaKey(m, [255, 0, 255]);
          magenta = true;
        }
      }
      log(`ok ${j.category} ${j.id} ${(Date.now() - t) / 1000}s${attempt ? ` (retry ${attempt})` : ''}`);
    } catch (e) {
      log(`FAIL ${j.id} attempt ${attempt + 1}: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
  if (!raw) return false;
  fs.writeFileSync(rawPath, raw);
  const { post, qa } = await finish({ ...j, magentaSubject: magenta }, raw);
  const entry: ManifestEntry = {
    id: j.id, path: outFile(j), category: j.category, source_type: 'ai_generated', source: 'gpt-image-2 via hjmai.yby.zone (project key)',
    license: 'Generated for this project; no third-party material', prompt: j.prompt, reference: j.ref, postprocess: post, hash: hash(j), qa,
  };
  byPath.set(entry.path, entry);
  return true;
}

let done = 0, failed = 0, idx = 0;
let lastSave = Date.now();
function saveManifest() {
  // merge with the on-disk manifest so parallel generator processes don't drop each other's entries
  try {
    const disk = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) as typeof manifest;
    for (const a of disk.assets ?? []) if (!byPath.has(a.path)) byPath.set(a.path, a);
  } catch { /* first write */ }
  manifest.generated = new Date().toISOString();
  manifest.assets = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
}
async function worker() {
  while (idx < todo.length) {
    const j = todo[idx++]!;
    const ok = await runJob(j).catch((e) => { log(`ERR ${j.id} ${(e as Error).message}`); return false; });
    if (ok) done++; else failed++;
    if (Date.now() - lastSave > 20_000) { saveManifest(); lastSave = Date.now(); }
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
saveManifest();
log(`finished: ${done} ok, ${failed} failed`);
