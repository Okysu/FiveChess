/**
 * Difficulty curve: one designer table instead of hand-editing hundreds of enemy numbers.
 * Enemy HP is scaled at spawn; enemy damage in calcDamage (so intent previews match resolution), and the
 * burn/poison stacks enemies apply in applyStatus. Ascension scaling stacks on top.
 * Tuned with scripts/sim-batch.ts + scripts/balance-model.ts — method, numbers and every change: docs/难度评估.md.
 */
import { content } from '../content';
import type { CombatState } from './state';

export interface Tune { hp: number; dmg: number }

export const BY_ACT_TIER: Record<number, Record<'easy' | 'normal' | 'elite' | 'boss', Tune>> = {
  1: { easy: { hp: 1, dmg: 1 }, normal: { hp: 0.9, dmg: 0.8 }, elite: { hp: 0.9, dmg: 0.9 }, boss: { hp: 0.85, dmg: 0.85 } },
  2: { easy: { hp: 0.78, dmg: 0.65 }, normal: { hp: 0.78, dmg: 0.62 }, elite: { hp: 0.76, dmg: 0.64 }, boss: { hp: 0.62, dmg: 0.6 } },
  3: { easy: { hp: 0.65, dmg: 0.52 }, normal: { hp: 0.65, dmg: 0.52 }, elite: { hp: 0.62, dmg: 0.54 }, boss: { hp: 0.57, dmg: 0.58 } },
  4: { easy: { hp: 1, dmg: 1 }, normal: { hp: 1, dmg: 1 }, elite: { hp: 1, dmg: 1 }, boss: { hp: 0.62, dmg: 0.66 } },
};

/** outliers the simulator flagged, multiplied on top of the act/tier row */
export const BY_ENCOUNTER: Record<string, Tune> = {
  // act 1 — hard-pool fights at ~2× the median HP loss, bosses evened out (see docs/难度评估.md)
  enc1_tomb_guard: { hp: 1, dmg: 0.8 },
  enc1_crossbows: { hp: 1, dmg: 0.85 }, // two 12-damage piercing volleys on one turn
  enc1_robbers: { hp: 1, dmg: 0.85 },
  enc1_graveyard: { hp: 0.9, dmg: 1 }, // four bodies incl. a healer
  enc1_boss_blank_stele: { hp: 0.95, dmg: 0.9 },
  enc1_boss_fox_mother: { hp: 0.95, dmg: 0.88 },
  enc1_boss_rust_general: { hp: 0.92, dmg: 0.92 },
  // act 2
  enc2_silt_swarm: { hp: 1, dmg: 0.8 }, // bell ringer stacks might on the crawlers
  enc2_clerks: { hp: 0.9, dmg: 0.75 },
  enc2_drowned_watch: { hp: 0.85, dmg: 0.72 },
  enc2_tide_rite: { hp: 0.9, dmg: 0.8 },
  enc2_deep_hunt: { hp: 0.9, dmg: 0.82 },
  enc2_clock_scholar: { hp: 0.95, dmg: 0.85 },
  enc2_elite_tide_general: { hp: 0.9, dmg: 0.8 },
  enc2_elite_coral_colossus: { hp: 0.85, dmg: 0.85 },
  enc2_boss_twin_judges: { hp: 0.72, dmg: 0.72 }, // reviving sidekick + delay combos make it a damage race
  enc2_boss_puppeteer: { hp: 0.82, dmg: 0.78 },
  enc2_boss_drowned_king: { hp: 0.9, dmg: 0.9 },
  // act 3
  enc3_flock_of_stars: { hp: 0.75, dmg: 0.7 }, // shepherd summons + chain buffs + a healer
  enc3_night_ink: { hp: 0.8, dmg: 0.72 },
  enc3_hall_of_mirrors: { hp: 0.8, dmg: 0.72 },
  enc3_lamp_vigil: { hp: 0.85, dmg: 0.8 },
  enc3_lamp_procession: { hp: 0.75, dmg: 0.7 }, // four bodies incl. a 16-HP healer
  enc3_meteor_charge: { hp: 0.9, dmg: 0.8 },
  enc3_orrery: { hp: 0.85, dmg: 0.8 },
  enc3_tolling_hall: { hp: 0.85, dmg: 0.7 }, // diviner stacks yin on the fate deck so the bell's delay always lands
  enc3_forbidden_stacks: { hp: 0.8, dmg: 0.85 }, // warden armor + golem growth outlast the bot
  enc3_boss_sunbird_shadow: { hp: 0.72, dmg: 0.7 }, // burn-heavy: 63–68% bot deaths vs 25–31% for the other act-3 bosses
  enc3_elite_ink_leviathan: { hp: 0.9, dmg: 0.85 },
  enc3_boss_eclipse_tengu: { hp: 0.9, dmg: 0.9 },
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
