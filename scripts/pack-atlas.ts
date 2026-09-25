/**
 * Runtime texture atlases: packs every small generated texture (icons, relics, potions, pips, gems, badges…)
 * into a few 2048² sheets so the game loads a handful of images instead of hundreds.
 *   npx tsx scripts/pack-atlas.ts        → assets/atlas/atlas_N.webp + atlas_N.json (Pixi spritesheet) + index.json
 * 9-slice textures (panels, buttons, frames…) stay standalone: NineSliceSprite needs the whole texture.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ASSETS = 'assets';
const OUT = path.join(ASSETS, 'atlas');
const SIZE = 2048, PAD = 2, MAX_EDGE = 320;
const PREFIXES = ['ui/icons/', 'ui/relics/', 'ui/potions/', 'ui/'];
// stretched / 9-sliced / full-screen textures must stay standalone
const STANDALONE = /^ui\/(panel_|button_|ribbon_|card_frame_|bar_|frame_|tag_|equip_slot|slider_track|token_frame|topbar|banner_band|rules_box|menu_panel|tex_|dim_|art_placeholder|card_back|fate_|shopkeeper|divider|smoke_overlay|frost_overlay|ward_bubble)/;

interface Item { key: string; file: string; w: number; h: number; x?: number; y?: number; sheet?: number }

const manifest = JSON.parse(fs.readFileSync(path.join(ASSETS, 'manifest.json'), 'utf8')) as { assets: { path: string }[] };
const items: Item[] = [];
for (const a of manifest.assets) {
  const key = a.path.replace(/\.[a-z0-9]+$/i, '');
  if (!PREFIXES.some((p) => key.startsWith(p)) || STANDALONE.test(key)) continue;
  if (key.startsWith('ui/') && key.split('/').length > 3) continue;
  const file = path.join(ASSETS, a.path);
  if (!fs.existsSync(file)) continue;
  const m = await sharp(file).metadata();
  if (Math.max(m.width!, m.height!) > MAX_EDGE) continue;
  items.push({ key, file, w: m.width!, h: m.height! });
}

// shelf packing, tallest first
items.sort((a, b) => b.h - a.h || b.w - a.w);
const sheets: Item[][] = [];
let sheet: Item[] = [], x = 0, y = 0, shelfH = 0;
for (const it of items) {
  if (x + it.w + PAD > SIZE) { x = 0; y += shelfH + PAD; shelfH = 0; }
  if (y + it.h + PAD > SIZE) { sheets.push(sheet); sheet = []; x = 0; y = 0; shelfH = 0; }
  it.x = x; it.y = y; it.sheet = sheets.length;
  sheet.push(it);
  x += it.w + PAD; shelfH = Math.max(shelfH, it.h);
}
if (sheet.length) sheets.push(sheet);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const index: Record<string, string> = {};
for (let s = 0; s < sheets.length; s++) {
  const list = sheets[s]!;
  const h = Math.min(SIZE, Math.max(...list.map((i) => i.y! + i.h)) + PAD);
  const name = `atlas_${s}`;
  await sharp({ create: { width: SIZE, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(await Promise.all(list.map(async (i) => ({ input: await sharp(i.file).png().toBuffer(), left: i.x!, top: i.y! }))))
    .webp({ quality: 88, alphaQuality: 92, effort: 5 }).toFile(path.join(OUT, `${name}.webp`));
  const frames: Record<string, unknown> = {};
  for (const i of list) {
    frames[i.key] = { frame: { x: i.x, y: i.y, w: i.w, h: i.h }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: i.w, h: i.h }, sourceSize: { w: i.w, h: i.h } };
    index[i.key] = `atlas/${name}.json`;
  }
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ frames, meta: { image: `${name}.webp`, format: 'RGBA8888', size: { w: SIZE, h }, scale: '1' } }));
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index));
console.log(`packed ${items.length} textures into ${sheets.length} atlas sheet(s)`);
