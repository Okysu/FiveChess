/**
 * Sprite-sheet art generation: many items per request, then sliced. ~6x fewer API calls than one image per item.
 *   npx tsx scripts/art/sheets.ts --only=card,enemy [--model=gpt-image-2.5-flare] [--max-calls=40] [--concurrency=3] [--dry]
 * Layout per category (cells sized to how large the art is actually shown in game):
 *   card 3x3 (≈512x341, card art window is 248x180)   event 2x2 (768x512)
 *   enemy 4x2 cutouts   boss / hero 3x1 cutouts   icon / relic / potion 4x3 cutouts
 * Cutouts are sliced by connected components of the alpha mask; paintings by the white gutters between panels.
 * Items that fail to slice stay undone so the next run (or generate.ts, one per item) picks them up.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { generate, isFatal, type Size } from './api';
import { STYLE_LOCK, ICON_STYLE, OBJECT_FORM, FACTION_TONE, ACT_TONE, CUTOUT_MAGENTA, flatSubject } from './style';
import type { ArtJob } from './jobs';
import { buildJobs } from './alljobs';
import { ASSETS, jobHash, outFile, openManifest, modelSource } from './manifest';
import type { Color } from '../../src/engine/defs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k!, v ?? 'true']; }));
const only = new Set((args.only ?? 'icon,relic,potion').split(','));
const model = args.model ?? process.env.ASSET_GEN_MODEL ?? 'gpt-image-2';
const concurrency = Number(args.concurrency ?? 3);
const maxCalls = args['max-calls'] ? Number(args['max-calls']) : Infinity;
const dry = args.dry === 'true';
const NATIVE_ALPHA = !/2\.5/.test(model);
const RAW = '.cache/art_raw/sheets';
const RUN = Date.now().toString(36);
const LOG = '.cache/art/gen.log';
fs.mkdirSync(RAW, { recursive: true });
const log = (s: string) => { const line = `[${new Date().toISOString()}] ${s}`; console.log(line); fs.appendFileSync(LOG, line + '\n'); };

interface Layout { cols: number; rows: number; size: Size; cutout: boolean; ref: string; kind: string }
const REF = (n: string) => `art-src/style_refs/${n}.png`;
const LAYOUT: Record<string, Layout> = {
  card: { cols: 3, rows: 3, size: '1536x1024', cutout: false, ref: REF('wb_card'), kind: 'separate small illustrations for playing cards, each a complete scene filling its own panel' },
  event: { cols: 2, rows: 2, size: '1536x1024', cutout: false, ref: REF('wb_background'), kind: 'separate landscape story illustrations, each a complete scene filling its own panel' },
  enemy: { cols: 4, rows: 2, size: '1536x1024', cutout: true, ref: REF('wb_enemy'), kind: 'separate full-body enemy characters, standing, each whole figure visible' },
  boss: { cols: 3, rows: 1, size: '1536x1024', cutout: true, ref: REF('wb_enemy'), kind: 'separate full-body boss characters, each whole figure visible and filling its column' },
  hero: { cols: 3, rows: 1, size: '1536x1024', cutout: true, ref: REF('wb_commander'), kind: 'separate full-body hero portraits, each whole figure visible and filling its column' },
  icon: { cols: 4, rows: 3, size: '1536x1024', cutout: true, ref: REF('ref_icon'), kind: 'round game-UI medallion icons' },
  relic: { cols: 4, rows: 3, size: '1536x1024', cutout: true, ref: REF('wb_card'), kind: 'separate magical artifact objects' },
  potion: { cols: 4, rows: 3, size: '1536x1024', cutout: true, ref: REF('wb_card'), kind: 'separate elixir / medicine objects' },
};

const { byPath, isDone, save } = openManifest();
const todo = buildJobs().filter((j) => only.has(j.category) && LAYOUT[j.category] && j.subject && !isDone(j));

// sheets never mix categories or groups (faction / act): the tone line must fit every item
const sheets: ArtJob[][] = [];
for (const cat of only) {
  const L = LAYOUT[cat];
  if (!L) continue;
  const per = L.cols * L.rows;
  const groups = new Map<string, ArtJob[]>();
  for (const j of todo.filter((x) => x.category === cat)) { const g = j.group ?? '-'; groups.set(g, [...(groups.get(g) ?? []), j]); }
  for (const list of groups.values()) for (let i = 0; i < list.length; i += per) sheets.push(list.slice(i, i + per));
}
const run = sheets.slice(0, maxCalls);
log(`sheets: ${todo.length} items → ${sheets.length} sheets (running ${run.length}), model=${model}, concurrency=${concurrency}`);
if (dry) { for (const s of run) console.log(s[0]!.category, s[0]!.group, s.length, s.map((j) => j.id).join(' ')); process.exit(0); }

function tone(j: ArtJob) {
  if (!j.group) return '';
  if (j.category === 'card' || j.category === 'hero') return FACTION_TONE[j.group as Color] ?? '';
  if (['enemy', 'boss', 'event'].includes(j.category)) return ACT_TONE[Number(j.group)] ?? '';
  return '';
}

function sheetPrompt(items: ArtJob[], L: Layout) {
  const cat = items[0]!.category;
  const list = items.map((j, i) => `${i + 1}) ${flatSubject(j.subject!)}`).join('; ');
  const sep = L.cutout
    ? (NATIVE_ALPHA ? 'with wide fully transparent gaps between items so no two items touch or overlap. Fully transparent background, no ground, no scenery.'
      : `with wide empty gaps between items so no two items touch or overlap. ${CUTOUT_MAGENTA.replace('Single subject isolated', 'Every item isolated')}`)
    : 'separated by thick plain white gutters about 30 pixels wide; every panel is a full rectangular painting edge to edge, all panels the same size.';
  const style = cat === 'icon' ? ICON_STYLE.replace('A single round', 'Each is a round').replace(/isolated on a fully transparent background\.?/i, '') : STYLE_LOCK;
  return `Create a completely new sprite sheet in exactly the same woodblock print style, carved outlines and flat colors as the reference image. ` +
    `A sheet of exactly ${items.length} ${L.kind}, laid out in a strict grid of ${L.cols} columns and ${L.rows} rows (${L.cols * L.rows} cells), ` +
    `each item centered in its own cell, ${sep} No grid lines, no labels, no numbers. ` +
    `Items in reading order (left to right, top to bottom): ${list}. ` +
    `Flat woodblock print only: no glow, no bloom, no gradients, no soft airbrush shading, no 3D rendering. ` +
    `${['relic', 'potion'].includes(cat) ? OBJECT_FORM : ''} ${tone(items[0]!)} ${style}`;
}

// ───────────── slicing ─────────────

interface Comp { x0: number; y0: number; x1: number; y1: number; area: number; cx: number; cy: number }

interface Labels { comps: Comp[]; w: number; h: number; S: number; gw: number; label: Int32Array }
async function components(buf: Buffer): Promise<Labels> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const S = 4, gw = Math.ceil(info.width / S), gh = Math.ceil(info.height / S);
  const mask = new Uint8Array(gw * gh);
  for (let y = 0; y < info.height; y += S) for (let x = 0; x < info.width; x += S) {
    if (data[(y * info.width + x) * 4 + 3]! > 40) mask[(y / S) * gw + x / S] = 1;
  }
  const seen = new Uint8Array(gw * gh);
  const label = new Int32Array(gw * gh); // component index + 1 per downsampled pixel
  const comps: Comp[] = [];
  const stack: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    let x0 = gw, y0 = gh, x1 = 0, y1 = 0, area = 0, sx = 0, sy = 0;
    stack.push(i); seen[i] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      const x = k % gw, y = (k / gw) | 0;
      label[k] = comps.length + 1;
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
  return { comps, w: info.width, h: info.height, S, gw, label };
}

/** rows = pieces whose vertical centres are within half a piece height; then left to right */
function readingOrder(cs: Comp[]): Comp[] {
  const rows: Comp[][] = [];
  for (const c of [...cs].sort((a, b) => a.cy - b.cy)) {
    const row = rows.find((r) => Math.abs(r[0]!.cy - c.cy) < (r[0]!.y1 - r[0]!.y0) / 2);
    if (row) row.push(c); else rows.push([c]);
  }
  return rows.flatMap((r) => r.sort((a, b) => a.cx - b.cx));
}

/** cutouts: group components by the cell holding their (or their nearest big neighbour's) centroid */
async function sliceCutouts(buf: Buffer, L: Layout, n: number): Promise<(Buffer | null)[]> {
  const { comps, w, h, S, gw, label } = await components(buf);
  const owner = new Int32Array(comps.length).fill(-1); // comp index -> cell
  const cw = w / L.cols, ch = h / L.rows, bigArea = cw * ch * 0.02;
  const big = comps.filter((c) => c.area > bigArea);
  // exactly n big pieces: trust the model's reading order even if it ignored the grid (e.g. one long row)
  const order: Comp[] = big.length === n ? readingOrder(big) : [];
  const cells: Comp[][] = Array.from({ length: Math.max(L.cols * L.rows, n) }, () => []);
  for (const c of comps) {
    const ref = c.area > bigArea ? c : [...big].sort((a, b) => Math.hypot(a.cx - c.cx, a.cy - c.cy) - Math.hypot(b.cx - c.cx, b.cy - c.cy))[0];
    if (!ref) continue;
    const idx = order.length ? order.indexOf(ref) : Math.min(L.rows - 1, Math.floor(ref.cy / ch)) * L.cols + Math.min(L.cols - 1, Math.floor(ref.cx / cw));
    cells[idx]!.push(c);
    owner[comps.indexOf(c)] = idx;
  }
  const out: (Buffer | null)[] = [];
  for (let i = 0; i < n; i++) {
    const cs = cells[i]!;
    if (!cs.some((c) => c.area > bigArea)) { out.push(null); continue; }
    const x0 = Math.max(0, Math.min(...cs.map((c) => c.x0)) - 6), y0 = Math.max(0, Math.min(...cs.map((c) => c.y0)) - 6);
    const x1 = Math.min(w, Math.max(...cs.map((c) => c.x1)) + 6), y1 = Math.min(h, Math.max(...cs.map((c) => c.y1)) + 6);
    // two items fused (when the reading order is trusted, a piece may span a whole column of the grid)
    if (!order.length && (x1 - x0 > cw * 1.3 || y1 - y0 > ch * 1.3)) { out.push(null); continue; }
    // clear pixels that belong to a neighbour's shapes (spears, ribbons reaching into this crop)
    const { data, info } = await sharp(buf).extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      const l = label[(((y + y0) / S) | 0) * gw + (((x + x0) / S) | 0)]!;
      if (l > 0 && owner[l - 1] !== i) data[(y * info.width + x) * 4 + 3] = 0;
    }
    out.push(await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).trim({ threshold: 1 }).png().toBuffer());
  }
  return out;
}

/** paintings: find the white gutter band near each expected cut line; fall back to the even grid */
async function slicePanels(buf: Buffer, L: Layout, n: number): Promise<(Buffer | null)[]> {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const white = (x: number, y: number) => { const i = (y * W + x) * 3; const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!; return r > 225 && g > 220 && b > 205 && Math.max(r, g, b) - Math.min(r, g, b) < 40; };
  const colW = (x: number) => { let k = 0; for (let y = 0; y < H; y += 3) if (white(x, y)) k++; return k / Math.ceil(H / 3); };
  const rowW = (y: number) => { let k = 0; for (let x = 0; x < W; x += 3) if (white(x, y)) k++; return k / Math.ceil(W / 3); };
  // returns [start,end) of the band of each gutter; outer edges trimmed the same way
  const bands = (len: number, cells: number, score: (p: number) => number) => {
    const cuts: [number, number][] = [];
    for (let k = 1; k < cells; k++) {
      const c = Math.round((len * k) / cells), r = Math.round((len / cells) * 0.18);
      let best = c, bs = -1;
      for (let p = c - r; p <= c + r; p++) { const s = score(p); if (s > bs) { bs = s; best = p; } }
      if (bs < 0.6) { cuts.push([c - 2, c + 2]); continue; } // no gutter: even split
      let a = best, b = best;
      while (a > 0 && score(a - 1) > 0.6) a--;
      while (b < len - 1 && score(b + 1) > 0.6) b++;
      cuts.push([a, b + 1]);
    }
    const edges: [number, number][] = [];
    let start = 0;
    while (start < len * 0.1 && score(start) > 0.6) start++;
    for (const [a, b] of cuts) { edges.push([start, a]); start = b; }
    let end = len;
    while (end > len * 0.9 && score(end - 1) > 0.6) end--;
    edges.push([start, end]);
    return edges;
  };
  const xs = bands(W, L.cols, colW), ys = bands(H, L.rows, rowW);
  const out: (Buffer | null)[] = [];
  for (let i = 0; i < n; i++) {
    const [x0, x1] = xs[i % L.cols]!, [y0, y1] = ys[Math.floor(i / L.cols)]!;
    const w = x1 - x0, h = y1 - y0;
    if (w < (W / L.cols) * 0.6 || h < (H / L.rows) * 0.6) { out.push(null); continue; }
    // a 1.5% inset drops any anti-aliased gutter fringe
    const ix = Math.round(w * 0.015), iy = Math.round(h * 0.015);
    out.push(await sharp(buf).extract({ left: x0 + ix, top: y0 + iy, width: w - ix * 2, height: h - iy * 2 }).png().toBuffer());
  }
  return out;
}

async function chromaKey(buf: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
    const d = Math.sqrt((r - 255) ** 2 + g ** 2 + (b - 255) ** 2);
    const a = d < 70 ? 0 : d < 150 ? Math.round(((d - 70) / 80) * 255) : 255;
    if (a > 0 && a < 255) { const m = Math.min(r, b); data[i] = Math.max(0, r - (m - g) * 0.8); data[i + 2] = Math.max(0, b - (m - g) * 0.8); }
    data[i + 3] = Math.min(data[i + 3]!, a);
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

// ───────────── run ─────────────

let calls = 0;
/** a partial sheet asks for a grid that fits its item count (4 enemies → 4x1), so cells stay meaningful */
function fit(L: Layout, n: number): Layout {
  if (n >= L.cols * L.rows) return L;
  const cols = Math.min(L.cols, n);
  return { ...L, cols, rows: Math.ceil(n / cols) };
}

async function runSheet(items: ArtJob[], si: number, rawFile?: string, tagOverride?: string) {
  const L = rawFile ? LAYOUT[items[0]!.category]! : fit(LAYOUT[items[0]!.category]!, items.length);
  const tag = tagOverride ?? (rawFile ? `${items[0]!.category}/${items[0]!.group ?? '-'}#${si}` : `${items[0]!.category}/${items[0]!.group ?? '-'}#${RUN}-${si}`);
  const t = Date.now();
  let raw: Buffer | null = rawFile ? fs.readFileSync(rawFile) : null;
  for (let attempt = 0; attempt <= 2 && !raw; attempt++) {
    try {
      calls++;
      raw = await generate({ model, prompt: sheetPrompt(items, L), size: L.size, quality: 'medium', transparent: L.cutout && NATIVE_ALPHA, ref: L.ref });
    } catch (e) {
      log(`FAIL sheet ${tag} attempt ${attempt + 1}: ${(e as Error).message}`);
      if (isFatal(e)) { save(); log('STOP: API account out of credit / unauthorized'); process.exit(2); }
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
    }
  }
  if (!raw) return 0;
  if (!rawFile) fs.writeFileSync(path.join(RAW, `${tag.replace(/[/#]/g, '_')}.png`), raw);
  if (L.cutout && !NATIVE_ALPHA) raw = await chromaKey(raw);
  const pieces = L.cutout ? await sliceCutouts(raw, L, items.length) : await slicePanels(raw, L, items.length);
  let ok = 0;
  for (let i = 0; i < items.length; i++) {
    const j = items[i]!, p = pieces[i];
    if (!p) { log(`sheet miss ${j.category} ${j.id} (cell ${i + 1} of ${tag})`); continue; }
    const dest = path.join(ASSETS, outFile(j));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await sharp(p).resize({ width: j.px, height: j.px, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: L.cutout ? 86 : 84, alphaQuality: 90, effort: 5 }).toFile(dest);
    byPath.set(outFile(j), {
      id: j.id, path: outFile(j), category: j.category, source_type: 'ai_generated', source: modelSource(model),
      license: 'Generated for this project; no third-party material', prompt: `[sprite sheet ${tag} cell ${i + 1}] ${j.subject}`,
      reference: L.ref, postprocess: `sprite sheet slice (${L.cutout ? 'alpha components' : 'gutter detection'}), resized≤${j.px}px, webp`, hash: jobHash(j), qa: 'ok',
    });
    ok++;
  }
  save();
  log(`ok sheet ${tag} ${ok}/${items.length} ${((Date.now() - t) / 1000).toFixed(1)}s ${model}`);
  return ok;
}

// --reslice=<raw sheet png>:<id,id,...> re-cuts an already generated sheet (no API call)
if (args.reslice) {
  const [file, ids] = args.reslice.split(':');
  const all = buildJobs();
  const items = ids!.split(',').map((id) => all.find((j) => j.id === id)!).filter(Boolean);
  const n = await runSheet(items, 0, file);
  save();
  log(`reslice ${file}: ${n}/${items.length}`);
  process.exit(0);
}

// --reslice-all: re-cut every complete cutout sheet recorded in the manifest (after slicer fixes; no API calls)
if (args['reslice-all']) {
  const all = new Map(buildJobs().map((j) => [j.id, j]));
  const bySheet = new Map<string, { cell: number; id: string }[]>();
  for (const e of byPath.values()) {
    const m = /^\[sprite sheet (\S+) cell (\d+)\]/.exec(e.prompt ?? '');
    if (m && LAYOUT[e.category]?.cutout) bySheet.set(m[1]!, [...(bySheet.get(m[1]!) ?? []), { cell: Number(m[2]), id: e.id }]);
  }
  let n = 0, sheetsDone = 0;
  for (const [tag, cells] of bySheet) {
    const file = path.join(RAW, `${tag.replace(/[/#]/g, '_')}.png`);
    cells.sort((a, b) => a.cell - b.cell);
    if (!fs.existsSync(file) || cells.some((c, i) => c.cell !== i + 1)) continue; // incomplete: skip
    const items = cells.map((c) => all.get(c.id)!).filter(Boolean);
    n += await runSheet(items, 0, file, tag);
    sheetsDone++;
  }
  save();
  log(`reslice-all: ${n} items from ${sheetsDone} sheets`);
  process.exit(0);
}

let idx = 0, total = 0;
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (idx < run.length) { const k = idx++; const n = await runSheet(run[k]!, k).catch((e) => { log(`ERR sheet #${k} ${(e as Error).message}`); return 0; }); total += n; }
}));
save();
log(`sheets finished: ${total}/${run.reduce((a, s) => a + s.length, 0)} items in ${calls} API calls`);
