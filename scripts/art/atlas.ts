/**
 * Sprite-sheet generation for small items (icons, relics, potions):
 * one 1536x1024 transparent request holds a 4x3 grid of 12 items, then it is sliced by connected
 * components (not a fixed grid — the model's spacing drifts) and each piece is saved like a normal job.
 *   npx tsx scripts/art/atlas.ts --only=relic,potion [--model=gpt-image-2] [--concurrency=4] [--limit=N]
 * Items whose cell comes back empty or merged with a neighbour are left undone, so generate.ts
 * (one image per item) picks them up on its next run.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { generate, isFatal } from './api';
import { STYLE_LOCK, ICON_STYLE, OBJECT_FORM } from './style';
import type { ArtJob } from './jobs';
import { buildJobs } from './alljobs';
import { ASSETS, jobHash, outFile, openManifest, modelSource } from './manifest';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k!, v ?? 'true']; }));
const only = new Set((args.only ?? 'icon,relic,potion').split(','));
const model = args.model ?? process.env.ASSET_GEN_MODEL ?? 'gpt-image-2';
const concurrency = Number(args.concurrency ?? 4);
const limit = args.limit ? Number(args.limit) : Infinity;
const COLS = 4, ROWS = 3, PER = COLS * ROWS, W = 1536, H = 1024;
const RAW = '.cache/art_raw/atlas';
const LOG = '.cache/art/gen.log';
fs.mkdirSync(RAW, { recursive: true });
const log = (s: string) => { const line = `[${new Date().toISOString()}] ${s}`; console.log(line); fs.appendFileSync(LOG, line + '\n'); };

const { byPath, isDone, save } = openManifest();
const todo = buildJobs().filter((j) => only.has(j.category) && j.subject && !isDone(j));

// sheets never mix categories: icons are medallions, relics/potions are loose objects
const sheets: ArtJob[][] = [];
for (const cat of only) {
  const list = todo.filter((j) => j.category === cat);
  for (let i = 0; i < list.length; i += PER) sheets.push(list.slice(i, i + PER));
}
const run = sheets.slice(0, limit);
log(`atlas: ${todo.length} items → ${run.length} sheets, model=${model}, concurrency=${concurrency}`);

function sheetPrompt(items: ArtJob[]) {
  const cat = items[0]!.category;
  const kind = cat === 'icon' ? 'round game-UI medallion icons' : cat === 'potion' ? 'separate elixir / medicine objects' : 'separate magical artifact objects';
  const list = items.map((j, i) => `${i + 1}) ${j.subject}`).join('; ');
  const style = cat === 'icon' ? ICON_STYLE.replace('A single round', 'Each is a round') : STYLE_LOCK;
  // without the style reference the model drifts to glowing digital fantasy; keep the woodblock ref + a flat-print rule
  return `Create a completely new sprite sheet in exactly the same woodblock print style, carved outlines and flat colors as the reference image. ` +
    `A sprite sheet of exactly ${items.length} ${kind}, laid out in a strict grid of ${COLS} columns and ${ROWS} rows, ` +
    `each item centered in its own cell, all items the same size, with wide fully transparent gaps between items so no two items touch or overlap. ` +
    `No grid lines, no frames around cells, no labels, no background — fully transparent background. ` +
    `Items in reading order (left to right, top to bottom): ${list}. ` +
    `Flat woodblock print only: no glow, no bloom, no gradients, no soft airbrush shading, no 3D rendering. ${cat === 'icon' ? '' : OBJECT_FORM} ${style}`;
}

interface Comp { x0: number; y0: number; x1: number; y1: number; area: number; cx: number; cy: number }

/** connected components of the alpha mask on a 4x-downsampled grid */
async function components(buf: Buffer): Promise<{ comps: Comp[]; w: number; h: number }> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const S = 4, gw = Math.ceil(info.width / S), gh = Math.ceil(info.height / S);
  const mask = new Uint8Array(gw * gh);
  for (let y = 0; y < info.height; y += S) for (let x = 0; x < info.width; x += S) {
    if (data[(y * info.width + x) * 4 + 3]! > 40) mask[(y / S) * gw + x / S] = 1;
  }
  const seen = new Uint8Array(gw * gh);
  const comps: Comp[] = [];
  const stack: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    let x0 = gw, y0 = gh, x1 = 0, y1 = 0, area = 0, sx = 0, sy = 0;
    stack.push(i); seen[i] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      const x = k % gw, y = (k / gw) | 0;
      area++; sx += x; sy += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const n of [k - 1, k + 1, k - gw, k + gw]) {
        if (n < 0 || n >= mask.length || seen[n] || !mask[n]) continue;
        if ((n === k - 1 && x === 0) || (n === k + 1 && x === gw - 1)) continue;
        seen[n] = 1; stack.push(n);
      }
    }
    comps.push({ x0: x0 * S, y0: y0 * S, x1: (x1 + 1) * S, y1: (y1 + 1) * S, area: area * S * S, cx: (sx / area) * S, cy: (sy / area) * S });
  }
  return { comps, w: info.width, h: info.height };
}

/** slice a sheet into per-cell pieces; null for cells that are empty or bleed into a neighbour */
async function slice(buf: Buffer, n: number): Promise<(Buffer | null)[]> {
  const { comps, w, h } = await components(buf);
  const cw = w / COLS, ch = h / ROWS;
  const big = comps.filter((c) => c.area > cw * ch * 0.02);
  const cells: Comp[][] = Array.from({ length: PER }, () => []);
  for (const c of comps) {
    // specks join the nearest big component's cell; big ones go by centroid
    const ref = c.area > cw * ch * 0.02 ? c : big.sort((a, b) => Math.hypot(a.cx - c.cx, a.cy - c.cy) - Math.hypot(b.cx - c.cx, b.cy - c.cy))[0];
    if (!ref) continue;
    const col = Math.min(COLS - 1, Math.floor(ref.cx / cw)), row = Math.min(ROWS - 1, Math.floor(ref.cy / ch));
    cells[row * COLS + col]!.push(c);
  }
  const out: (Buffer | null)[] = [];
  for (let i = 0; i < n; i++) {
    const cs = cells[i]!;
    if (!cs.some((c) => c.area > cw * ch * 0.02)) { out.push(null); continue; }
    const x0 = Math.max(0, Math.min(...cs.map((c) => c.x0)) - 6), y0 = Math.max(0, Math.min(...cs.map((c) => c.y0)) - 6);
    const x1 = Math.min(w, Math.max(...cs.map((c) => c.x1)) + 6), y1 = Math.min(h, Math.max(...cs.map((c) => c.y1)) + 6);
    // a piece much larger than its cell means two items fused together
    if (x1 - x0 > cw * 1.25 || y1 - y0 > ch * 1.25) { out.push(null); continue; }
    const piece = await sharp(buf).extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }).png().toBuffer();
    out.push(piece);
  }
  return out;
}

async function runSheet(items: ArtJob[], si: number) {
  const t = Date.now();
  let raw: Buffer | null = null;
  for (let attempt = 0; attempt <= 2 && !raw; attempt++) {
    try {
      const ref = items[0]!.category === 'icon' ? 'art-src/style_refs/ref_icon.png' : 'art-src/style_refs/wb_card.png';
      raw = await generate({ model, prompt: sheetPrompt(items), size: '1536x1024', quality: 'medium', transparent: true, ref });
    } catch (e) {
      log(`FAIL atlas ${items[0]!.category}#${si} attempt ${attempt + 1}: ${(e as Error).message}`);
      if (isFatal(e)) { save(); log('STOP: API account out of credit / unauthorized'); process.exit(2); }
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
    }
  }
  if (!raw) return 0;
  fs.writeFileSync(path.join(RAW, `${items[0]!.category}_${si}.png`), raw);
  const pieces = await slice(raw, items.length);
  let ok = 0;
  for (let i = 0; i < items.length; i++) {
    const j = items[i]!, p = pieces[i];
    if (!p) { log(`atlas miss ${j.category} ${j.id} (cell ${i + 1}) → left for single-image pass`); continue; }
    const dest = path.join(ASSETS, outFile(j));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await sharp(p).resize({ width: j.px, height: j.px, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 86, alphaQuality: 90, effort: 5 }).toFile(dest);
    byPath.set(outFile(j), {
      id: j.id, path: outFile(j), category: j.category, source_type: 'ai_generated', source: modelSource(model),
      license: 'Generated for this project; no third-party material', prompt: `[sprite sheet cell ${i + 1}] ${j.subject}`,
      postprocess: 'atlas slice (connected components), trimmed, resized, webp', hash: jobHash(j), qa: 'ok',
    });
    ok++;
  }
  save();
  log(`ok atlas ${items[0]!.category}#${si} ${ok}/${items.length} ${((Date.now() - t) / 1000).toFixed(1)}s ${model}`);
  return ok;
}

let idx = 0, total = 0;
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (idx < run.length) { const k = idx++; total += await runSheet(run[k]!, k).catch((e) => { log(`ERR atlas #${k} ${(e as Error).message}`); return 0; }); }
}));
save();
log(`atlas finished: ${total}/${run.reduce((a, s) => a + s.length, 0)} items`);
