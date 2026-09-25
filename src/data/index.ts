/**
 * Content loader. Every JSON file under src/data is bundled at build time via import.meta.glob
 * (browser) or read from disk (node scripts / tests, see scripts/load-content.ts).
 */
import type { ContentBundle } from '../engine/content';
import type { CardDef, CommanderDef, EncounterDef, EnemyDef, EventDef, LieutenantDef, PotionDef, RelicDef } from '../engine/defs';

type Mod = { default: unknown };

export function bundleFromModules(mods: Record<string, Mod>): ContentBundle {
  const b: ContentBundle = { cards: [], commanders: [], lieutenants: [], enemies: [], encounters: [], relics: [], potions: [], events: [] };
  for (const [path, m] of Object.entries(mods)) {
    const data = m.default as unknown[];
    if (!Array.isArray(data)) continue;
    const p = path.replace(/\\/g, '/');
    if (p.includes('/cards/')) b.cards.push(...(data as CardDef[]));
    else if (p.includes('/enemies/')) b.enemies.push(...(data as EnemyDef[]));
    else if (p.endsWith('/commanders.json')) b.commanders.push(...(data as CommanderDef[]));
    else if (p.endsWith('/lieutenants.json')) b.lieutenants.push(...(data as LieutenantDef[]));
    else if (p.includes('/encounters')) b.encounters.push(...(data as EncounterDef[]));
    else if (p.includes('/relics')) b.relics.push(...(data as RelicDef[]));
    else if (p.endsWith('/potions.json')) b.potions.push(...(data as PotionDef[]));
    else if (p.includes('/events')) b.events.push(...(data as EventDef[]));
  }
  return b;
}

export function loadBrowserBundle(): ContentBundle {
  const mods = import.meta.glob<Mod>('./**/*.json', { eager: true });
  const filtered: Record<string, Mod> = {};
  for (const [k, v] of Object.entries(mods)) if (!k.includes('/lore/')) filtered[k] = v;
  return bundleFromModules(filtered);
}
