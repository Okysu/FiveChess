/**
 * Image re-encode experiment: for sample assets, find the smallest AVIF / WebP whose SSIM vs the current file
 * stays ≥ the target (visually identical). Prints size savings per category.
 *   npx tsx scripts/img-quality.ts [--target=0.99]
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k!, v ?? 'true']; }));
const TARGET = Number(args.target ?? 0.99);

/** SSIM on luma, 8×8 windows (plus alpha channel error folded in for transparent images) */
export async function ssim(a: Buffer, b: Buffer): Promise<number> {
  const A = await sharp(a).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const B = await sharp(b).ensureAlpha().resize(A.info.width, A.info.height).raw().toBuffer({ resolveWithObject: true });
  const W = A.info.width, H = A.info.height;
  const lum = (d: Buffer, i: number) => { const al = d[i + 3]! / 255; return (0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!) * al; };
  const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2;
  let sum = 0, n = 0;
  for (let y = 0; y + 8 <= H; y += 8) for (let x = 0; x + 8 <= W; x += 8) {
    let ma = 0, mb = 0;
    const va: number[] = [], vb: number[] = [];
    for (let dy = 0; dy < 8; dy++) for (let dx = 0; dx < 8; dx++) { const i = ((y + dy) * W + x + dx) * 4; const p = lum(A.data, i), q = lum(B.data, i); va.push(p); vb.push(q); ma += p; mb += q; }
    ma /= 64; mb /= 64;
    let sa = 0, sb = 0, sab = 0;
    for (let k = 0; k < 64; k++) { sa += (va[k]! - ma) ** 2; sb += (vb[k]! - mb) ** 2; sab += (va[k]! - ma) * (vb[k]! - mb); }
    sa /= 63; sb /= 63; sab /= 63;
    sum += ((2 * ma * mb + C1) * (2 * sab + C2)) / ((ma * ma + mb * mb + C1) * (sa + sb + C2));
    n++;
  }
  return n ? sum / n : 1;
}

async function best(src: Buffer, fmt: 'avif' | 'webp'): Promise<{ q: number; size: number; s: number } | null> {
  // binary search the lowest quality that keeps SSIM ≥ target
  let lo = 30, hi = 95, found: { q: number; size: number; s: number } | null = null;
  while (lo <= hi) {
    const q = Math.round((lo + hi) / 2);
    const out = fmt === 'avif' ? await sharp(src).avif({ quality: q, effort: 6 }).toBuffer() : await sharp(src).webp({ quality: q, effort: 6, smartSubsample: true, alphaQuality: 90 }).toBuffer();
    const s = await ssim(src, out);
    if (s >= TARGET) { found = { q, size: out.length, s }; hi = q - 1; } else lo = q + 1;
  }
  return found;
}

if (process.argv[1]?.endsWith('img-quality.ts')) {
  const samples: Record<string, string[]> = {
    cards: ['assets/cards/R/r_basic_strike.webp', 'assets/cards/B/b_frost_palm.webp', 'assets/cards/G/g_heartwood_pendant.webp'],
    backgrounds: ['assets/backgrounds/title.webp', 'assets/backgrounds/battle_1.webp', 'assets/backgrounds/events/ev_mingpai_yu.webp'],
    figures: ['assets/heroes/r_huojin.webp', 'assets/enemies/e1_bone_spear.webp', 'assets/bosses/e1_boss_rust_general.webp'],
    ui: ['assets/ui/panel_dark.webp', 'assets/ui/tex_paper.webp', 'assets/ui/logo.webp'],
    atlas: ['assets/atlas/atlas_0.webp'],
  };
  for (const [cat, files] of Object.entries(samples)) {
    let cur = 0, av = 0, wb = 0;
    const qs: string[] = [];
    for (const f of files) {
      if (!fs.existsSync(f)) continue;
      const src = fs.readFileSync(f);
      const a = await best(src, 'avif'), w = await best(src, 'webp');
      cur += src.length; av += a?.size ?? src.length; wb += Math.min(w?.size ?? src.length, src.length);
      qs.push(`${path.basename(f)} avif q${a?.q} webp q${w?.q}`);
    }
    console.log(`${cat.padEnd(12)} now ${(cur / 1024) | 0}K → avif ${(av / 1024) | 0}K (${Math.round((1 - av / cur) * 100)}%) · webp ${(wb / 1024) | 0}K (${Math.round((1 - wb / cur) * 100)}%)  [${qs.join('; ')}]`);
  }
}
