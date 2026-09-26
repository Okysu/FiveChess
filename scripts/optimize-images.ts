/**
 * AVIF companions for transparent art (figures, UI kit, atlases): for each file, the lowest AVIF quality whose SSIM
 * vs the current WebP is ≥ 0.99 (visually identical). Written as <name>.avif next to the .webp only when it saves
 * ≥ 10%; assets/avif.json lists them. The game loads the AVIF when the browser decodes AVIF, else the WebP.
 * Opaque paintings (cards, backgrounds) gain < 5% from AVIF and are left alone.
 *   npm run img:avif      (cached by source hash in .cache/avif/index.json)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { ssim } from './img-quality';

const TARGET = 0.99, MIN_SAVING = 0.1, JOBS = 6;
const DIRS = ['assets/heroes', 'assets/enemies', 'assets/bosses', 'assets/ui', 'assets/atlas', 'assets/effects', 'assets/frames'];
const CACHE = '.cache/avif/index.json';
fs.mkdirSync(path.dirname(CACHE), { recursive: true });
const cache: Record<string, { q: number | null; size: number }> = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};

const files = DIRS.flatMap((d) => fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.webp')).map((f) => path.join(d, f)) : []);
const out: string[] = [];
let before = 0, after = 0, idx = 0;

async function one(f: string) {
  const src = fs.readFileSync(f);
  const key = crypto.createHash('sha1').update(src).digest('hex');
  const dest = f.replace(/\.webp$/, '.avif');
  let hit = cache[key];
  if (!hit || (hit.q !== null && !fs.existsSync(dest))) {
    const meta = await sharp(src).metadata();
    if (!meta.hasAlpha && !f.includes(`${path.sep}atlas${path.sep}`)) { hit = { q: null, size: src.length }; }
    else {
      let lo = 40, hi = 90, best: { q: number; buf: Buffer } | null = null;
      while (lo <= hi) {
        const q = Math.round((lo + hi) / 2);
        const buf = await sharp(src).avif({ quality: q, effort: 5 }).toBuffer();
        if ((await ssim(src, buf)) >= TARGET) { best = { q, buf }; hi = q - 1; } else lo = q + 1;
      }
      if (best && best.buf.length <= src.length * (1 - MIN_SAVING)) { fs.writeFileSync(dest, best.buf); hit = { q: best.q, size: best.buf.length }; }
      else hit = { q: null, size: src.length };
    }
    cache[key] = hit;
  }
  before += src.length;
  if (hit.q !== null && fs.existsSync(dest)) {
    out.push(f.replace(/\\/g, '/').replace(/^assets\//, '').replace(/\.webp$/, ''));
    after += hit.size;
    const json = f.replace(/\.webp$/, '.json');
    if (f.includes('atlas') && fs.existsSync(json)) {
      const j = JSON.parse(fs.readFileSync(json, 'utf8'));
      j.meta.image = path.basename(dest);
      fs.writeFileSync(f.replace(/\.webp$/, '.avif.json'), JSON.stringify(j));
    }
  }
  else { after += src.length; if (fs.existsSync(dest)) fs.rmSync(dest); }
}

await Promise.all(Array.from({ length: JOBS }, async () => { while (idx < files.length) { const f = files[idx++]!; await one(f).catch((e) => console.error(f, (e as Error).message)); } }));
fs.writeFileSync(CACHE, JSON.stringify(cache));
fs.writeFileSync('assets/avif.json', JSON.stringify(out.sort()));
console.log(`avif: ${out.length}/${files.length} files · ${(before / 1048576).toFixed(1)}MB → ${(after / 1048576).toFixed(1)}MB (${Math.round((1 - after / before) * 100)}% smaller)`);
