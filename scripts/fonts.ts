/**
 * Offline fonts for the desktop / mobile clients (the website keeps Google Fonts): subsets 马善政 and Noto Serif SC
 * (variable, weights kept) to every character the game can show, as woff2 in assets/fonts/.
 *   npx tsx scripts/fonts.ts   (re-run when text or content changes; `npm run build:native` checks coverage)
 */
import fs from 'node:fs';
import path from 'node:path';
import subsetFont from 'subset-font';

const SRC = 'art-src/fonts';
const OUT = 'assets/fonts';
const roots = ['src', 'index.html'];
const chars = new Set<string>();
const walk = (p: string) => {
  const st = fs.statSync(p);
  if (st.isDirectory()) { for (const f of fs.readdirSync(p)) walk(path.join(p, f)); return; }
  if (!/\.(ts|json|html|md)$/.test(p)) return;
  for (const ch of fs.readFileSync(p, 'utf8')) chars.add(ch);
};
roots.forEach(walk);
// printable ASCII, full-width forms and common punctuation are always kept
for (let c = 0x20; c < 0x7f; c++) chars.add(String.fromCharCode(c));
for (const ch of '，。、；：？！…—～·「」『』（）《》【】“”‘’％＋－×÷●○◆◇■□▲△★☆←→↑↓✕✓') chars.add(ch);
const text = [...chars].filter((ch) => ch.codePointAt(0)! >= 0x20).join('');

fs.mkdirSync(OUT, { recursive: true });
const jobs: [string, string][] = [['MaShanZheng-Regular.ttf', 'mashanzheng.woff2'], ['NotoSerifSC-VF.ttf', 'notoserifsc.woff2']];
for (const [src, out] of jobs) {
  const buf = await subsetFont(fs.readFileSync(path.join(SRC, src)), text, { targetFormat: 'woff2' });
  fs.writeFileSync(path.join(OUT, out), buf);
  console.log(`${out}: ${(buf.length / 1024).toFixed(0)} KB`);
}
fs.writeFileSync(path.join(OUT, 'fonts.css'), `/* offline fonts for the desktop and mobile clients (scripts/fonts.ts); SIL OFL 1.1, see OFL-*.txt */
@font-face { font-family: "Ma Shan Zheng"; src: url("/fonts/mashanzheng.woff2") format("woff2"); font-weight: 400; font-display: block; }
@font-face { font-family: "Noto Serif SC"; src: url("/fonts/notoserifsc.woff2") format("woff2"); font-weight: 200 900; font-display: block; }
`);
for (const f of fs.readdirSync(SRC).filter((f) => f.startsWith('OFL'))) fs.copyFileSync(path.join(SRC, f), path.join(OUT, f));
console.log(`fonts: ${chars.size} characters`);
