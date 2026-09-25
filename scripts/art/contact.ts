/** QA contact sheet: npx tsx scripts/art/contact.ts out.png dir id1 id2 ... (magenta = transparency) */
import sharp from 'sharp';
import path from 'node:path';

const [out, dir, ...ids] = process.argv.slice(2);
if (!out || !dir || !ids.length) throw new Error('usage: contact.ts out.png dir id...');
const T = 300, COLS = Math.min(5, ids.length);
const tiles = await Promise.all(ids.map(async (id) => {
  const img = await sharp(path.join(dir, id.includes('.') ? id : `${id}.webp`))
    .resize(T, T - 24, { fit: 'contain', background: { r: 255, g: 0, b: 255, alpha: 0 } })
    .flatten({ background: '#ff00ff' }).png().toBuffer();
  const label = Buffer.from(`<svg width="${T}" height="24"><rect width="100%" height="100%" fill="#222"/><text x="6" y="17" font-size="15" fill="#fff" font-family="monospace">${id}</text></svg>`);
  return sharp({ create: { width: T, height: T, channels: 3, background: '#ff00ff' } })
    .composite([{ input: img, top: 0, left: 0 }, { input: label, top: T - 24, left: 0 }]).png().toBuffer();
}));
const rows = Math.ceil(ids.length / COLS);
await sharp({ create: { width: T * COLS, height: T * rows, channels: 3, background: '#111' } })
  .composite(tiles.map((t, i) => ({ input: t, left: (i % COLS) * T, top: Math.floor(i / COLS) * T })))
  .png().toFile(out);
console.log('wrote', out);
