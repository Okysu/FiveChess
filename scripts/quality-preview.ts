/**
 * Quality comparison page: same crop of several assets at different encodings, 1:1, with file sizes,
 * plus an estimate of the total asset size per option. Writes .cache/quality-preview.html.
 *   npx tsx scripts/quality-preview.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp, { type Sharp } from 'sharp';
import { ssim } from './img-quality';

interface Sample { label: string; file: string; raw?: string; crop: { left: number; top: number; width: number; height: number } }
const samples: Sample[] = [
  { label: '卡牌插画 · 炎斩（不透明画作）', file: 'assets/cards/R/r_basic_strike.webp', crop: { left: 60, top: 40, width: 360, height: 240 } },
  { label: '主帅立绘 · 霍烬（透明底）', file: 'assets/heroes/r_huojin.webp', crop: { left: 150, top: 60, width: 360, height: 360 } },
  { label: '背景 · 标题', file: 'assets/backgrounds/title.webp', raw: '.cache/art_raw/backgrounds__title.png', crop: { left: 600, top: 300, width: 480, height: 320 } },
  { label: '界面 · 面板边框（透明底）', file: 'assets/ui/panel_dark.webp', crop: { left: 0, top: 0, width: 360, height: 240 } },
];
const OPTIONS: { key: string; name: string; enc: (s: Sharp) => Sharp }[] = [
  { key: 'webp90', name: 'WebP 90', enc: (s) => s.webp({ quality: 90, effort: 6, alphaQuality: 95 }) },
  { key: 'webp75', name: 'WebP 75', enc: (s) => s.webp({ quality: 75, effort: 6, alphaQuality: 90, smartSubsample: true }) },
  { key: 'webp60', name: 'WebP 60', enc: (s) => s.webp({ quality: 60, effort: 6, alphaQuality: 85, smartSubsample: true }) },
  { key: 'avif65', name: 'AVIF 65', enc: (s) => s.avif({ quality: 65, effort: 5 }) },
  { key: 'avif50', name: 'AVIF 50', enc: (s) => s.avif({ quality: 50, effort: 5 }) },
  { key: 'avif35', name: 'AVIF 35', enc: (s) => s.avif({ quality: 35, effort: 5 }) },
];

const b64 = (buf: Buffer, mime: string) => `data:${mime};base64,${buf.toString('base64')}`;
const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
const cards: string[] = [];

for (const s of samples) {
  const cur = fs.readFileSync(s.file);
  const src = s.raw && fs.existsSync(s.raw) ? fs.readFileSync(s.raw) : cur;
  const srcMeta = await sharp(src).metadata(), curMeta = await sharp(cur).metadata();
  // everything is compared at the shipped resolution
  const base = await sharp(src).resize(curMeta.width, curMeta.height).png().toBuffer();
  const crop = async (buf: Buffer) => sharp(buf).extract(s.crop).png().toBuffer();
  const cells: string[] = [];
  cells.push(`<figure><img src="${b64(await crop(base), 'image/png')}"><figcaption><b>${s.raw && fs.existsSync(s.raw) ? '原图 PNG' : '当前文件解码'}</b><span>参考</span></figcaption></figure>`);
  cells.push(`<figure><img src="${b64(await crop(cur), 'image/png')}"><figcaption><b>当前 WebP</b><span>${kb(cur.length)}</span></figcaption></figure>`);
  for (const o of OPTIONS) {
    const out = await o.enc(sharp(base)).toBuffer();
    const q = await ssim(base, out);
    cells.push(`<figure><img src="${b64(await crop(out), 'image/png')}"><figcaption><b>${o.name}</b><span>${kb(out.length)} · SSIM ${q.toFixed(3)}</span></figcaption></figure>`);
  }
  cards.push(`<section><h2>${s.label}</h2><p class="dim">${curMeta.width}×${curMeta.height}${srcMeta.width !== curMeta.width ? `（原图 ${srcMeta.width}×${srcMeta.height}）` : ''} · 截取区域 1:1 显示</p><div class="grid">${cells.join('')}</div></section>`);
}

// total size estimate per option: sample every 8th file of each folder
const dirs = ['assets/cards', 'assets/backgrounds', 'assets/heroes', 'assets/enemies', 'assets/bosses', 'assets/ui', 'assets/atlas'];
const all: string[] = [];
const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.webp')) all.push(p); } };
for (const d of dirs) if (fs.existsSync(d)) walk(d);
const pick = all.filter((_, i) => i % 8 === 0);
const tot: Record<string, number> = { current: 0 };
for (const o of OPTIONS) tot[o.key] = 0;
for (const f of pick) {
  const buf = fs.readFileSync(f);
  tot.current! += buf.length;
  for (const o of OPTIONS) tot[o.key]! += (await o.enc(sharp(buf)).toBuffer()).length;
}
const full = all.reduce((a, f) => a + fs.statSync(f).size, 0);
const scale = full / tot.current!;
const rows = [['当前 WebP', full], ...OPTIONS.map((o) => [o.name, tot[o.key]! * scale] as [string, number])]
  .map(([n, v]) => `<tr><td>${n}</td><td>${((v as number) / 1048576).toFixed(1)} MB</td><td>${Math.round(((v as number) / full - 1) * 100)}%</td></tr>`).join('');

const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><title>画质对比</title>
<style>
:root{--bg:#14100e;--fg:#f3e6c6;--dim:#b5a384;--card:#221a16;--gold:#f3d488}
body{margin:0;padding:24px 16px 60px;background:var(--bg);color:var(--fg);font-family:"Noto Serif SC",serif}
h1{margin:0 0 6px}h2{margin:32px 0 4px;color:var(--gold)}.dim{color:var(--dim);margin:0 0 12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
figure{margin:0;background:var(--card);border-radius:8px;overflow:hidden}
figure img{display:block;width:100%;image-rendering:auto;background:repeating-conic-gradient(#3a302a 0 25%,#2a221e 0 50%) 0 0/20px 20px}
figcaption{display:flex;justify-content:space-between;gap:8px;padding:8px 10px;font-size:14px}figcaption span{color:var(--dim)}
table{border-collapse:collapse;margin-top:12px}td{padding:6px 16px;border-bottom:1px solid #3a302a}
</style>
<h1>素材画质对比</h1>
<p class="dim">每组同一区域 1:1 放大。SSIM ≥ 0.99 基本看不出差别；0.97–0.99 细看纹理略软；&lt; 0.97 可能出现色块或晕染。</p>
<h2>全部素材总体积估算（抽样换算）</h2><table>${rows}</table>
${cards.join('')}
</html>`;
fs.writeFileSync('.cache/quality-preview.html', html);
console.log('wrote .cache/quality-preview.html', (html.length / 1048576).toFixed(1), 'MB; sampled', pick.length, 'of', all.length);
