/**
 * Difficulty curve: one designer table instead of hand-editing hundreds of enemy numbers.
 * Enemy HP is scaled at spawn; enemy damage in calcDamage (so intent previews match resolution).
 * Tuned from scripts/simulate.ts runs — see docs/平衡报告.md. Ascension scaling stacks on top.
 */
import { content } from '../content';
import type { CombatState } from './state';

export interface Tune { hp: number; dmg: number }

export const BY_ACT_TIER: Record<number, Record<'easy' | 'normal' | 'elite' | 'boss', Tune>> = {
  1: { easy: { hp: 1, dmg: 1 }, normal: { hp: 0.9, dmg: 0.8 }, elite: { hp: 0.9, dmg: 0.85 }, boss: { hp: 0.9, dmg: 0.85 } },
  2: { easy: { hp: 1, dmg: 1 }, normal: { hp: 0.9, dmg: 0.8 }, elite: { hp: 0.88, dmg: 0.78 }, boss: { hp: 0.8, dmg: 0.78 } },
  3: { easy: { hp: 1, dmg: 1 }, normal: { hp: 0.92, dmg: 0.82 }, elite: { hp: 0.88, dmg: 0.8 }, boss: { hp: 0.82, dmg: 0.8 } },
  4: { easy: { hp: 1, dmg: 1 }, normal: { hp: 1, dmg: 1 }, elite: { hp: 1, dmg: 1 }, boss: { hp: 1, dmg: 1 } },
};

/** outliers the simulator flagged, multiplied on top of the act/tier row */
export const BY_ENCOUNTER: Record<string, Tune> = {
  enc1_boss_rust_general: { hp: 0.85, dmg: 0.85 }, // 75% bot death rate vs ~45% for the other act-1 bosses
  enc1_tomb_guard: { hp: 1, dmg: 0.85 },
  enc2_drowned_watch: { hp: 0.9, dmg: 0.8 },
  enc2_clerks: { hp: 0.95, dmg: 0.85 },
  enc2_boss_twin_judges: { hp: 0.8, dmg: 0.8 }, // reviving sidekick makes it a damage race; 80% bot death before
  enc2_boss_puppeteer: { hp: 0.9, dmg: 0.85 },
  enc2_elite_tide_general: { hp: 0.9, dmg: 0.8 },
};

const cache = new Map<string, Tune>();
let enabled = true;

/** rule tests run on untuned numbers so their exact expectations stay about the rules */
export function setTuning(on: boolean) { enabled = on; cache.clear(); }

export function encounterTune(encounterId: string): Tune {
  if (!enabled) return { hp: 1, dmg: 1 };
  const hit = cache.get(encounterId);
  if (hit) return hit;
  const enc = content().encounters.get(encounterId);
  let t: Tune = { hp: 1, dmg: 1 };
  if (enc && encounterId !== 'sandbox') {
    const row = BY_ACT_TIER[Math.min(4, Math.max(1, enc.act))]!;
    const tier = enc.tier === 'normal' && enc.pool === 'easy' ? 'easy' : (enc.tier as 'normal' | 'elite' | 'boss');
    const base = row[tier] ?? { hp: 1, dmg: 1 };
    const o = BY_ENCOUNTER[encounterId] ?? { hp: 1, dmg: 1 };
    t = { hp: base.hp * o.hp, dmg: base.dmg * o.dmg };
  }
  cache.set(encounterId, t);
  return t;
}

export const combatTune = (s: CombatState) => encounterTune(s.cfg.encounter);
