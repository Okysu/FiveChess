/** Drop generated outputs so they regenerate: npx tsx scripts/art/unmark.ts <path-prefix-or-marker> (e.g. "sprite sheet" or ui/relics/) */
import fs from 'node:fs';
import path from 'node:path';
import { ASSETS, MANIFEST } from './manifest';

const key = process.argv[2];
if (!key) throw new Error('usage: unmark.ts <path prefix | prompt marker>');
const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) as { assets: { path: string; prompt?: string }[] };
const drop = m.assets.filter((a) => a.path.startsWith(key) || (a.prompt ?? '').includes(key));
for (const a of drop) fs.rmSync(path.join(ASSETS, a.path), { force: true });
m.assets = m.assets.filter((a) => !drop.includes(a));
fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 1));
console.log(`removed ${drop.length}:`, drop.map((a) => a.path).join(' '));
