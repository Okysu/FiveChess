/**
 * Android launcher icons + splash screens from the game logo (art-src/logo), written into android/app/src/main/res.
 *   npx tsx scripts/android-assets.ts   (re-run after `npx cap add android` or when the logo changes)
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp, { type Sharp } from 'sharp';

const RES = 'android/app/src/main/res';
const ICON = 'art-src/logo/app_icon.png';
const LOGO = 'art-src/logo/logo.png';
const INK = '#0b0806';
const DENS: [string, number][] = [['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4]];

const out = async (file: string, img: Sharp) => { fs.mkdirSync(path.dirname(file), { recursive: true }); await img.png().toFile(file); };

for (const [d, k] of DENS) {
  const legacy = Math.round(48 * k), fg = Math.round(108 * k), inner = Math.round(72 * k);
  const dir = path.join(RES, `mipmap-${d}`);
  await out(path.join(dir, 'ic_launcher.png'), sharp(ICON).resize(legacy, legacy));
  const circle = Buffer.from(`<svg width="${legacy}" height="${legacy}"><circle cx="${legacy / 2}" cy="${legacy / 2}" r="${legacy / 2}" fill="#fff"/></svg>`);
  await out(path.join(dir, 'ic_launcher_round.png'), sharp(await sharp(ICON).resize(legacy, legacy).toBuffer()).composite([{ input: circle, blend: 'dest-in' }]));
  // adaptive foreground: the icon inside the 72dp safe area of the 108dp layer, on the ink background colour
  const icon = await sharp(ICON).resize(inner, inner).toBuffer();
  await out(path.join(dir, 'ic_launcher_foreground.png'), sharp({ create: { width: fg, height: fg, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: icon, gravity: 'centre' }]));
}
fs.writeFileSync(path.join(RES, 'values/ic_launcher_background.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0B0806</color>\n</resources>\n`);

// splash: the logo centred on ink, both orientations
const SPLASH: [string, number, number][] = [['mdpi', 480, 320], ['hdpi', 800, 480], ['xhdpi', 1280, 720], ['xxhdpi', 1600, 960], ['xxxhdpi', 1920, 1280]];
for (const [d, w, h] of SPLASH) {
  for (const [orient, W, H] of [['land', w, h], ['port', h, w]] as const) {
    const size = Math.round(Math.min(W, H) * 0.62);
    const logo = await sharp(LOGO).resize(size, size, { fit: 'inside' }).toBuffer();
    await out(path.join(RES, `drawable-${orient}-${d}`, 'splash.png'), sharp({ create: { width: W, height: H, channels: 3, background: INK } }).composite([{ input: logo, gravity: 'centre' }]));
  }
}
const logo = await sharp(LOGO).resize(300, 300, { fit: 'inside' }).toBuffer();
await out(path.join(RES, 'drawable', 'splash.png'), sharp({ create: { width: 480, height: 480, channels: 3, background: INK } }).composite([{ input: logo, gravity: 'centre' }]));
console.log('android icons + splash written');
