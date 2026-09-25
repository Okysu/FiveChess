/** Node-side content loading (scripts, tests, simulator). */
import fs from 'node:fs';
import path from 'node:path';
import { bundleFromModules } from '../src/data/index';
import { Content, setContent, type ContentBundle } from '../src/engine/content';

export const DATA_DIR = path.resolve(import.meta.dirname ?? __dirname, '../src/data');

export function listJson(dir = DATA_DIR): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listJson(p));
    else if (e.name.endsWith('.json')) out.push(p);
  }
  return out;
}

export function readBundle(): { bundle: ContentBundle; files: Record<string, unknown> } {
  const mods: Record<string, { default: unknown }> = {};
  const files: Record<string, unknown> = {};
  for (const f of listJson()) {
    if (f.replace(/\\/g, '/').includes('/lore/')) continue;
    const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
    mods[f] = { default: raw };
    files[f] = raw;
  }
  return { bundle: bundleFromModules(mods), files };
}

export function loadContent(): Content {
  const { bundle } = readBundle();
  const c = new Content(bundle);
  setContent(c);
  return c;
}
