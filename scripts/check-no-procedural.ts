/**
 * Enforces the art rule: no procedurally drawn UI. Every visible element must be a generated
 * woodblock texture rendered through src/game/ui/skin.ts. Fails (exit 1) on any violation.
 *   - Graphics may only be created inside skin.ts (invisible masks / hit areas / sector masks).
 *   - 2D-canvas drawing is only allowed in richtext.ts, and only for text + drawImage of textures.
 *   - No gradients anywhere.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname ?? __dirname, '../src/game');
const files: string[] = [];
const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.ts')) files.push(p); } };
walk(ROOT);

const RULES: { re: RegExp; msg: string; allow?: string[] }[] = [
  { re: /new Graphics\(/, msg: 'Graphics outside skin.ts', allow: ['skin.ts'] },
  { re: /\.(fill|stroke)\(\{?\s*(color|fill|width)|\.(fill|stroke)\((0x|'#|"#)/, msg: 'shape fill/stroke', allow: ['skin.ts'] },
  { re: /\.(roundRect|circle|ellipse|poly|moveTo|bezierCurveTo|quadraticCurveTo)\(/, msg: 'shape path', allow: ['skin.ts'] },
  { re: /getContext\(['"]2d['"]\)/, msg: 'canvas 2D drawing', allow: ['richtext.ts'] },
  { re: /\b(fillRect|strokeRect|createLinearGradient|createRadialGradient|beginPath)\b/, msg: 'canvas shape drawing' },
  { re: /FillGradient|vgrad|hgrad|rgrad/, msg: 'gradient' },
  { re: /from ['"][./]*canvasIcons['"]/, msg: 'procedural canvas icons' },
];

const bad: string[] = [];
for (const f of files) {
  const name = path.basename(f);
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((l, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
    for (const r of RULES) if (r.re.test(l) && !(r.allow ?? []).includes(name)) bad.push(`${path.relative(ROOT, f)}:${i + 1}  [${r.msg}]  ${l.trim().slice(0, 110)}`);
  });
}
if (bad.length) {
  console.error(bad.join('\n'));
  console.error(`\n${bad.length} procedural-UI violation(s). All UI must use generated woodblock textures via src/game/ui/skin.ts.`);
  process.exit(1);
}
console.log('no procedural UI ✔');
