/**
 * Copies the game content (src/data/**\/*.json) into the Godot port (godot/data) and writes the derived index
 * the GDScript content registry needs to load it in exactly the order the TS engine does:
 *   godot/data/_index.json = {
 *     files:   bundle files in scripts/load-content.ts order (lore excluded) — Map insertion order in the TS
 *              Content registry follows this order and several rolls iterate it (filterCards → pick),
 *     collate: { id: rank } for every content id sorted with String.prototype.localeCompare (the run layer
 *              sorts encounter / potion / lieutenant / event ids that way; GDScript has no ICU collation),
 *     localeEqualsCodepoint: whether localeCompare order equals plain code-point order for all ids (informational)
 *   }
 * Idempotent: only rewrites files whose bytes changed and deletes stale files under godot/data.
 *   npx tsx scripts/sync-godot-data.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, listJson, readBundle } from './load-content';

const OUT = path.resolve(DATA_DIR, '../../godot/data');

function writeIfChanged(file: string, content: Buffer | string): boolean {
  const buf = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
  if (fs.existsSync(file) && fs.readFileSync(file).equals(buf)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  return true;
}

export function syncGodotData(log = true): { written: number; removed: number } {
  let written = 0;
  let removed = 0;
  const all = listJson();
  const rel = (f: string) => path.relative(DATA_DIR, f).replace(/\\/g, '/');
  const keep = new Set<string>();
  for (const f of all) {
    const r = rel(f);
    keep.add(r);
    if (writeIfChanged(path.join(OUT, r), fs.readFileSync(f))) written++;
  }
  // the bundle order (lore excluded, exactly like readBundle)
  const files = all.filter((f) => !f.replace(/\\/g, '/').includes('/lore/')).map(rel);
  const { bundle } = readBundle();
  const ids = new Set<string>();
  for (const list of Object.values(bundle)) for (const x of list as { id: string }[]) ids.add(x.id);
  const byLocale = [...ids].sort((a, b) => a.localeCompare(b));
  const byCode = [...ids].sort();
  const collate: Record<string, number> = {};
  byLocale.forEach((id, i) => { collate[id] = i; });
  const index = { files, collate, localeEqualsCodepoint: byLocale.join('\n') === byCode.join('\n') };
  keep.add('_index.json');
  if (writeIfChanged(path.join(OUT, '_index.json'), JSON.stringify(index, null, 1) + '\n')) written++;
  // stale files
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); if (!fs.readdirSync(p).length) fs.rmdirSync(p); continue; }
      const r = path.relative(OUT, p).replace(/\\/g, '/');
      if (r.endsWith('.json') && !keep.has(r)) { fs.unlinkSync(p); removed++; }
    }
  };
  walk(OUT);
  if (log) console.log(`godot/data: ${written} written, ${removed} removed, ${files.length} bundle files, ${ids.size} ids, localeCompare==codepoint: ${index.localeEqualsCodepoint}`);
  return { written, removed };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).replace(/\.ts$/, '') === path.resolve(import.meta.dirname ?? __dirname, 'sync-godot-data');
if (isMain) syncGodotData();
