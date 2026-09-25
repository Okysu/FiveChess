/**
 * Style lab: renders the same 5 samples in several candidate art directions so one can be chosen.
 *   npx tsx scripts/art/style-lab.ts [--only=pixel16,ink]
 * Output: art-src/style_lab/<style>/<sample>.png (+ <sample>_px.png: true-pixel post-processed for pixel styles)
 */
import fs from 'node:fs';
import sharp from 'sharp';
import { generate, type Size } from './api';

const OUT = 'art-src/style_lab';
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k!, v ?? 'true']; }));
const only = args.only ? new Set(args.only.split(',')) : null;

export interface StyleDef { id: string; name: string; desc: string; lock: string; pixel?: { grid: number; colors: number } }

export const STYLES: StyleDef[] = [
  {
    id: 'pixel16', name: '像素 · 16位精绘', desc: 'SNES 时代 JRPG 式的高细节像素画，有限调色板与抖动，东方幻想题材。',
    lock: 'Rendered as authentic high-detail 16-bit pixel art like a classic SNES-era JRPG: crisp hard-edged pixel clusters, a limited 32-color palette, ordered dithering for gradients, 1-pixel dark outlines, no anti-aliasing, no blur, no painterly strokes. Eastern fantasy subject. No text, no letters, no watermark.',
    pixel: { grid: 192, colors: 32 },
  },
  {
    id: 'pixel8', name: '像素 · 粗颗粒独立风', desc: '低分辨率大像素、粗黑描边、16 色平涂，现代独立 Roguelike 质感。',
    lock: 'Rendered as bold low-resolution pixel art in a modern indie roguelike style: big chunky pixels as if drawn on a 96x96 canvas then scaled up, thick dark outlines, flat 16-color palette with 2-3 tone shading, strong readable silhouette, no anti-aliasing, no gradients, no painterly texture. Eastern fantasy subject. No text, no letters, no watermark.',
    pixel: { grid: 112, colors: 16 },
  },
  {
    id: 'ink', name: '水墨写意', desc: '宣纸水墨，大量留白，墨色为主，仅以朱砂与花青点色。',
    lock: 'Painted as a traditional Chinese ink-wash painting (shuimo): expressive calligraphic brush strokes and ink bleeds on aged rice paper, mostly black and grey ink tones with sparse accents of cinnabar red and indigo, generous empty negative space, loose and elegant, not digital-looking, no glossy rendering. No text, no calligraphy characters, no seals, no watermark.',
  },
  {
    id: 'woodblock', name: '木版年画', desc: '粗黑刻线、平涂矿物色、纸纹与轻微套色错位。',
    lock: 'Made as a Chinese woodblock print (traditional New Year print): bold carved black outlines, flat saturated mineral colors (vermilion, malachite green, azurite blue, ochre), visible paper grain, slight color misregistration, decorative flat composition, no shading gradients, no 3D rendering. No text, no characters, no seals, no watermark.',
  },
  {
    id: 'puppet', name: '皮影戏', desc: '半透明彩色皮影，镂空纹样与关节，背后灯火透光。',
    lock: 'Depicted in the style of Chinese shadow puppetry (piying): figures made of translucent dyed leather with intricate cut-out patterns and visible rivet joints on limbs, flat profile poses, lit from behind by warm lantern light through a paper screen, rich amber and crimson translucency, theatrical. No text, no characters, no watermark.',
  },
  {
    id: 'inked', name: '墨线版画·暗黑奇幻', desc: '厚重手绘墨线 + 低饱和平涂水粉，剪影强烈的哥特暗黑卡牌风。',
    lock: 'Drawn as a hand-inked dark fantasy graphic-novel illustration: heavy confident black ink linework and hatching, flat muted gouache colors with limited palette, strong silhouettes and stark shadows, gritty and atmospheric, eastern fantasy costume details, not glossy, not airbrushed, not photorealistic. No text, no letters, no watermark.',
  },
];

const SAMPLES: { id: string; name: string; size: Size; transparent: boolean; subject: string }[] = [
  { id: 'commander', name: '主帅立绘', size: '1024x1536', transparent: true, subject: 'Full-body standing figure of a battle-hardened general in red-bronze lamellar armor and a flowing crimson cloak, holding a broad saber with an ember-glowing edge, stern expression. Single character, isolated on a transparent background.' },
  { id: 'card', name: '卡牌插画', size: '1024x1024', transparent: false, subject: 'Card illustration: a young flame priestess in vermilion robes kneeling as blossoms of fire bloom from her open palms, sparks rising into a dark temple. Full-bleed square composition, subject centered slightly above the middle.' },
  { id: 'enemy', name: '敌人', size: '1024x1024', transparent: true, subject: 'Full-body enemy: a gaunt skeletal spearman wrapped in tattered funeral cloth and rusted bronze armor, green ghost-fire in its eye sockets, lunging stance. Single figure, isolated on a transparent background.' },
  { id: 'background', name: '战斗背景', size: '1536x1024', transparent: false, subject: 'Wide battle background: a misty forest of toppled ancient stone steles and gnarled pines at dusk with green will-o-wisps, open flat ground across the middle and lower half, darker top.' },
  { id: 'ui', name: 'UI 套件', size: '1536x1024', transparent: false, subject: 'A game UI asset sheet on a plain dark background, neatly arranged with spacing: three horizontal buttons (normal, hovered, pressed), two decorative dialog panels with ornate borders, an empty playing-card frame with a cost gem at the top-left corner and an empty art window, a health bar, and six small round icons (sword, shield, flame, star, eye, coin). All elements empty with absolutely no text, no letters, no numbers.' },
];

async function pixelize(src: Buffer, grid: number, colors: number, transparent: boolean): Promise<Buffer> {
  const meta = await sharp(src).metadata();
  const w = meta.width!, h = meta.height!;
  const gw = w >= h ? grid : Math.round((grid * w) / h);
  const gh = h > w ? grid : Math.round((grid * h) / w);
  let small = sharp(src).resize(gw, gh, { kernel: 'nearest' });
  const pal = await small.png({ palette: true, colors, dither: 0.6 }).toBuffer();
  // hard alpha edge for sprites
  let img = sharp(pal).ensureAlpha();
  if (transparent) {
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    for (let i = 3; i < data.length; i += 4) data[i] = data[i]! > 110 ? 255 : 0;
    img = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
  }
  return img.resize(gw * Math.ceil(w / gw), gh * Math.ceil(h / gh), { kernel: 'nearest' }).png().toBuffer();
}

const jobs = STYLES.filter((s) => !only || only.has(s.id)).flatMap((st) => SAMPLES.map((sm) => ({ st, sm })));
let i = 0;
async function worker() {
  while (i < jobs.length) {
    const { st, sm } = jobs[i++]!;
    const dir = `${OUT}/${st.id}`;
    fs.mkdirSync(dir, { recursive: true });
    const file = `${dir}/${sm.id}.png`;
    if (fs.existsSync(file) && !args.force) continue;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const t = Date.now();
        const buf = await generate({ prompt: `${sm.subject} ${st.lock}`, size: sm.size, quality: 'medium', transparent: sm.transparent });
        fs.writeFileSync(file, buf);
        if (st.pixel) fs.writeFileSync(`${dir}/${sm.id}_px.png`, await pixelize(buf, sm.id === 'background' || sm.id === 'ui' ? Math.round(st.pixel.grid * 1.6) : st.pixel.grid, st.pixel.colors, sm.transparent));
        console.log('ok', st.id, sm.id, (Date.now() - t) / 1000 + 's');
        break;
      } catch (e) { console.log('FAIL', st.id, sm.id, (e as Error).message); }
    }
  }
}
await Promise.all(Array.from({ length: 3 }, worker));
fs.writeFileSync(`${OUT}/styles.json`, JSON.stringify({ styles: STYLES.map(({ id, name, desc, pixel }) => ({ id, name, desc, pixel: !!pixel })), samples: SAMPLES.map(({ id, name }) => ({ id, name })) }, null, 1));
console.log('done');
