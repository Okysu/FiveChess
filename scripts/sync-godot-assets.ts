/**
 * Copies the generated game assets into the Godot project so the Godot UI (godot/ui, godot/screens) can load them
 * with the same keys as src/game/assets.ts:
 *   assets/**\/*.{webp,ogg,mp3,json}   -> godot/assets/**      (the packed atlases in assets/atlas are skipped: every
 *                                                              frame also exists as its own file, Godot loads those)
 *   art-src/fonts/*.{ttf,txt}           -> godot/fonts/         (Noto Serif SC variable + Ma Shan Zheng, with OFL texts)
 *   art-src/logo/app_icon.png           -> godot/icon.png       (window / Android launcher icon)
 * Idempotent: only rewrites files whose bytes changed and deletes stale copies (never touches Godot's *.import files
 * of files that still exist).
 *   npx tsx scripts/sync-godot-assets.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GODOT = path.join(ROOT, 'godot');
const EXT = new Set(['.webp', '.ogg', '.mp3', '.json']);
const SKIP_DIRS = new Set(['atlas', '_gen_cache']);

function writeIfChanged(src: string, dst: string): boolean {
  const buf = fs.readFileSync(src);
  if (fs.existsSync(dst) && fs.statSync(dst).size === buf.length && fs.readFileSync(dst).equals(buf)) return false;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, buf);
  return true;
}

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, out); } else out.push(p);
  }
  return out;
}

export function syncGodotAssets(log = true) {
  let written = 0, removed = 0;
  const keep = new Set<string>();
  const copy = (src: string, dst: string) => { keep.add(path.resolve(dst)); if (writeIfChanged(src, dst)) written++; };
  const srcRoot = path.join(ROOT, 'assets');
  const dstRoot = path.join(GODOT, 'assets');
  for (const f of walk(srcRoot)) {
    if (!EXT.has(path.extname(f).toLowerCase())) continue;
    copy(f, path.join(dstRoot, path.relative(srcRoot, f)));
  }
  const fontSrc = path.join(ROOT, 'art-src', 'fonts');
  for (const f of fs.readdirSync(fontSrc)) if (/\.(ttf|otf|txt)$/i.test(f)) copy(path.join(fontSrc, f), path.join(GODOT, 'fonts', f));
  copy(path.join(ROOT, 'art-src', 'logo', 'app_icon.png'), path.join(GODOT, 'icon.png'));
  // stale copies (and their .import sidecars) under godot/assets
  for (const f of walk(dstRoot)) {
    const ext = path.extname(f).toLowerCase();
    if (ext === '.import') {
      const base = f.slice(0, -'.import'.length);
      if (!fs.existsSync(base)) { fs.unlinkSync(f); removed++; }
      continue;
    }
    if (EXT.has(ext) && !keep.has(path.resolve(f))) { fs.unlinkSync(f); removed++; if (fs.existsSync(f + '.import')) fs.unlinkSync(f + '.import'); }
  }
  if (log) console.log(`sync-godot-assets: ${written} written, ${removed} removed, ${keep.size} files tracked`);
  return { written, removed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) syncGodotAssets();
