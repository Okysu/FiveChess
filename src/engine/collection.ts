/** 图鉴收集: what the codex counts (same filters as the codex tabs) and how much of it a profile has discovered. */
import { content } from './content';
import type { Profile } from './meta';

export function codexTotals(): { cards: string[]; enemies: string[]; relics: string[] } {
  const c = content();
  return {
    cards: [...c.cards.values()].filter((d) => d.pool !== false && !['token', 'special', 'basic'].includes(d.rarity) && d.type !== 'status' && d.type !== 'curse').map((d) => d.id),
    enemies: [...c.enemies.values()].filter((e) => e.tier !== 'minion' && !e.id.startsWith('sandbox')).map((e) => e.id),
    relics: [...c.relics.values()].map((r) => r.id),
  };
}

export interface CodexProgress { cards: [number, number]; enemies: [number, number]; relics: [number, number]; pct: number }

export function codexProgress(p: Profile): CodexProgress {
  const t = codexTotals();
  const has = (ids: string[], found: string[]): [number, number] => { const f = new Set(found); return [ids.filter((id) => f.has(id)).length, ids.length]; };
  const cards = has(t.cards, p.discovered.cards), enemies = has(t.enemies, p.discovered.enemies), relics = has(t.relics, p.discovered.relics);
  const pct = (cards[0] + enemies[0] + relics[0]) / Math.max(1, cards[1] + enemies[1] + relics[1]);
  return { cards, enemies, relics, pct };
}
