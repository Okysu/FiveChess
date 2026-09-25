/**
 * Analytic difficulty model (no combat engine): expected enemy pressure per encounter vs expected player
 * output per turn, turns-to-kill, HP loss per fight and the HP budget of each act.
 *   npx tsx scripts/balance-model.ts [--asc=0] [--md=.cache/sim/model.md] [--outliers]
 *
 * It is deliberately coarse. Card and move effects are reduced to a "damage-equivalent" (DE) using the
 * weights below; utility (draw, fate manipulation, cost tricks) is only roughly priced. Use it to spot
 * outliers and to sanity-check the act × tier multipliers in src/engine/combat/tuning.ts — the simulator
 * (scripts/simulate.ts, scripts/sim-batch.ts) is the ground truth for the greedy bot.
 */
import fs from 'node:fs';
import { loadContent } from './load-content';
import { encounterTune } from '../src/engine/combat/tuning';
import { generateMap, type MapNode } from '../src/engine/run/map';
import { rand, seedRng, shuffle, type RngState } from '../src/engine/rng';
import type { CardDef, EnemyAI, EnemyDef, EncounterDef } from '../src/engine/defs';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k!, v ?? 'true']; }));
const ASC = Number(args.asc ?? 0);
const c = loadContent();

// ───────────── weights (tunable assumptions) ─────────────
/** a drawn card / created card is worth this much DE (average playable card in a mid deck) */
const W_CARD = 4;
/** armor is worth slightly less than damage: some of it is wasted on turns the enemy doesn't attack */
const W_ARMOR = 0.8;
/** average number of living enemies an AoE hits over a fight */
const AOE_TARGETS = 1.8;
/** typical enemy damage per turn used to price weak/freeze on enemies */
const ENEMY_DPT_REF = 9;
/** fraction of a unit's HP that intercepts enemy attacks (melee must hit the front row first) */
const UNIT_SOAK = 0.5;
/** turns a player unit keeps attacking on average */
const UNIT_LIFE = 2.2;

// placeholder numbers for dynamic counts ({count:...}) when no board exists
const COUNT_GUESS: Record<string, number> = {
  armor: 8, sources: 5, readySources: 3, embers: 2, cardsPlayed: 2, units: 2, hand: 5, drawPile: 12, discardPile: 6,
  exhaustPile: 1, signs: 1, judgeRank: 7, x: 3, lastDamage: 8, turn: 3, sacrificed: 3, eventAmount: 5, judgesThisTurn: 1,
  equipped: 1, delays: 1, counter: 1, deadThisCombat: 2, responsesThisCombat: 2, weaponAtk: 3, selected: 1,
  atk: 3, hp: 5, maxHp: 6, missingHp: 10,
};

function val(v: Any, vars: Record<string, number> = {}, atk = 0): number {
  if (v === undefined || v === null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { if (v === '$atk') return atk; return vars[v.slice(1)] ?? 3; }
  if ('count' in v) {
    if (v.count === 'status') return v.status === 'burn' ? 4 : v.status === 'poison' ? 5 : 1;
    if (v.count === 'atk' && v.of === 'commander') return 3;
    return COUNT_GUESS[v.count] ?? 2;
  }
  if ('add' in v) return v.add.reduce((s: number, x: Any) => s + val(x, vars, atk), 0);
  if ('mul' in v) return v.mul.reduce((s: number, x: Any) => s * val(x, vars, atk), 1);
  if ('sub' in v) return val(v.sub[0], vars, atk) - val(v.sub[1], vars, atk);
  if ('div' in v) return val(v.div[0], vars, atk) / Math.max(1, val(v.div[1], vars, atk));
  if ('max' in v) return Math.max(...v.max.map((x: Any) => val(x, vars, atk)));
  if ('min' in v) return Math.min(...v.min.map((x: Any) => val(x, vars, atk)));
  return 2;
}

/** total damage of X burn: X, ⌊X/2⌋, … */
export function burnTotal(x: number) { let t = 0; for (let b = Math.floor(x); b > 0; b = Math.floor(b / 2)) t += b; return t; }
/** total damage of X poison over at most 5 ticks: X, X-1, … */
export function poisonTotal(x: number) { let t = 0; for (let p = Math.floor(x), k = 0; p > 0 && k < 5; p--, k++) t += p; return t; }

interface DE { dmg: number; aoe: number; armor: number; util: number; heal: number }
const zero = (): DE => ({ dmg: 0, aoe: 0, armor: 0, util: 0, heal: 0 });
const addDE = (a: DE, b: DE, k = 1) => { a.dmg += b.dmg * k; a.aoe += b.aoe * k; a.armor += b.armor * k; a.util += b.util * k; a.heal += b.heal * k; return a; };
export const total = (d: DE) => d.dmg + d.aoe * AOE_TARGETS + (d.armor + d.heal) * W_ARMOR + d.util * W_CARD;

// ───────────── player-side effect pricing ─────────────
const AOE_SEL = new Set(['allEnemies', 'enemyUnits', 'enemyFront', 'enemyBack', 'allCharacters', 'allUnits']);
const ENEMY_SEL = new Set(['target', 'randomEnemy', 'randomEnemyUnit', 'eventSource', 'declaredActor', 'enemyCommander', 'eventTarget', 'it']);
const SELF_SEL = new Set(['commander', 'self', 'friendly', 'allFriendly']);

function sel(t: Any): 'aoe' | 'enemy' | 'self' | 'friendlyUnits' | 'other' {
  if (typeof t !== 'string') return t?.side === 'enemy' ? (t.pick === 'all' || !t.pick ? 'aoe' : 'enemy') : 'other';
  if (AOE_SEL.has(t)) return 'aoe';
  if (ENEMY_SEL.has(t)) return 'enemy';
  if (SELF_SEL.has(t)) return 'self';
  if (t === 'friendlyUnits' || t === 'otherFriendlyUnits' || t === 'randomFriendlyUnit' || t === 'adjacent') return 'friendlyUnits';
  return 'other';
}

function statusDE(st: string, x: number, where: string): DE {
  const d = zero();
  const put = (k: 'dmg' | 'armor', n: number) => { if (where === 'aoe' && k === 'dmg') d.aoe += n; else d[k] += n * (where === 'aoe' ? AOE_TARGETS : 1); };
  if (where === 'self') {
    if (st === 'might') d.dmg += x * 5; // +X per attack-damage hit, ~5 hits per fight
    else if (st === 'tenacity') d.armor += x * 4;
    else if (st === 'regen') d.heal += poisonTotal(x);
    return d;
  }
  if (st === 'burn') put('dmg', burnTotal(x));
  else if (st === 'poison') put('dmg', poisonTotal(x));
  else if (st === 'vulnerable') put('dmg', x * 4);
  else if (st === 'weak') put('armor', x * ENEMY_DPT_REF * 0.25);
  else if (st === 'freeze') put('armor', x * ENEMY_DPT_REF * 0.7);
  else if (st === 'stun') put('armor', ENEMY_DPT_REF);
  return d;
}

function unitDE(u: Any, vars: Record<string, number> = {}): DE {
  const d = zero();
  if (!u) return d;
  const atk = val(u.atk, vars), hp = val(u.hp, vars);
  const kw: string[] = u.keywords ?? [];
  let attacks = UNIT_LIFE + (kw.includes('haste') ? 1 : 0);
  if (kw.includes('twinStrike')) attacks *= 1.8;
  d.dmg += atk * attacks * (kw.includes('ranged') ? 1.15 : 1);
  d.armor += hp * UNIT_SOAK * (kw.includes('taunt') ? 1.5 : 1);
  if (u.growth) d.dmg += val(u.growth, vars) * 2.5;
  if (u.thorns) d.dmg += val(u.thorns, vars) * 1.5;
  if (u.ward) d.armor += 5;
  if (kw.includes('lifesteal')) d.heal += atk * attacks * 0.8;
  for (const t of u.triggers ?? []) addDE(d, effectsDE(t.effects, vars), triggerTimes(t.on));
  if (u.aura?.length) d.dmg += 3; // +1 atk to ~1.5 neighbours for ~2 turns
  return d;
}

function triggerTimes(on: string): number {
  if (['turnStart', 'turnEnd', 'opponentTurnStart', 'opponentTurnEnd'].includes(on)) return 3;
  if (['cardPlayed', 'cardDiscarded', 'cardSacrificed', 'attacking', 'dealtDamage'].includes(on)) return 2.5;
  if (['judged', 'unitDied', 'responsePlayed', 'rejudged', 'unitSummoned'].includes(on)) return 2;
  return 1;
}

let tokenDepth = 0;
function tokenDE(id: string): DE {
  const d = c.cards.get(id);
  if (!d || tokenDepth > 2) return zero(); // tokens that summon each other (轮回古榕 ↔ 榕种)
  tokenDepth++;
  try { return d.type === 'unit' ? unitDE(d.unit, (d.vars ?? {}) as Record<string, number>) : effectsDE(d.effects ?? [], (d.vars ?? {}) as Record<string, number>); } finally { tokenDepth--; }
}

function judgeDE(br: Any, vars: Record<string, number>, enemyPOV: boolean, atk: number): DE {
  const d = zero();
  const f = (effs: Any[] | undefined, w: number) => { if (effs) addDE(d, enemyPOV ? moveEffectsDmgAsDE(effs, vars, atk) : effectsDE(effs, vars), w); };
  if (br.yang || br.yin) { f(br.yang, 0.5); f(br.yin, 0.5); }
  else if (br.sun || br.thunder || br.moon || br.mountain) { f(br.sun, 0.25); f(br.thunder, 0.25); f(br.moon, 0.25); f(br.mountain, 0.25); }
  if (br.high || br.low) { f(br.high, 6 / 13); f(br.low, 7 / 13); }
  for (const r of br.ranks ?? []) f(r.effects, Math.max(0, Math.min(13, r.max) - Math.max(1, r.min) + 1) / 13);
  f(br.always, 1);
  return d;
}

function effectsDE(effs: Any[], vars: Record<string, number> = {}): DE {
  const d = zero();
  for (const e of effs ?? []) {
    const where = sel(e.target);
    switch (e.op) {
      case 'damage': {
        const n = val(e.amount, vars) * (val(e.times, vars) || 1);
        if (where === 'aoe') d.aoe += n; else if (where === 'enemy' || where === 'other') d.dmg += n;
        break;
      }
      case 'attack': d.dmg += (e.amount !== undefined ? val(e.amount, vars) : 3) * (val(e.times, vars) || 1); break;
      case 'armor': if (where !== 'enemy') d.armor += val(e.amount, vars) * (where === 'friendlyUnits' ? 1.5 : 1); break;
      case 'heal': d.heal += val(e.amount, vars); break;
      case 'ward': d.armor += 6 * val(e.amount, vars); break;
      case 'status': addDE(d, statusDE(e.status, val(e.amount, vars), where === 'other' ? 'enemy' : where)); break;
      case 'buff': {
        const a = val(e.atk, vars), h = val(e.hp, vars), k = where === 'friendlyUnits' && e.target === 'friendlyUnits' ? 2 : 1;
        d.dmg += a * k * (e.until === 'turn' ? 1 : UNIT_LIFE); d.armor += h * k * UNIT_SOAK;
        break;
      }
      case 'summon': { const n = val(e.n ?? 1, vars); addDE(d, e.atk !== undefined ? unitDE({ atk: e.atk, hp: e.hp }, vars) : tokenDE(e.unit), n); break; }
      case 'draw': d.util += val(e.n, vars); break;
      case 'discard': d.util -= 0.3 * val(e.n, vars); break;
      case 'create': { const n = val(e.n ?? 1, vars); if (typeof e.card === 'string') { const t = c.cards.get(e.card); if (t && t.type !== 'status' && t.type !== 'curse') addDE(d, tokenDE(e.card), n * (e.fleeting ? 0.6 : 0.8)); } else d.util += 0.7 * n; break; }
      case 'discover': d.util += 0.9; break;
      case 'fetch': d.util += 0.8 * val(e.n, vars); break;
      case 'energy': d.util += 0.35 * val(e.n, vars); break;
      case 'gainSource': d.util += 0.8 * val(e.n, vars); break;
      case 'refresh': d.util += 0.35 * val(e.n, vars); break;
      case 'costMod': d.util += 0.4; break;
      case 'emberCap': d.util += 0.2; break;
      case 'sign': d.util += 0.35 * val(e.n, vars); break;
      case 'stargaze': case 'peek': d.util += 0.15; break;
      case 'fateAdd': d.util += 0.1; break;
      case 'cancel': d.armor += 12; break;
      case 'redirect': d.armor += 9; break;
      case 'kill': if (where === 'enemy') d.dmg += 14; break;
      case 'judge': addDE(d, judgeDE(e.branches, vars, false, 0)); break;
      case 'delay': { const dc = c.cards.get(e.card); if (dc?.delay) addDE(d, judgeDE(dc.delay.branches, dc.vars ?? {}, false, 0)); break; }
      case 'weapon': d.dmg += val(e.atk ?? 3, vars) * Math.min(4, val(e.durability ?? 3, vars)); break;
      case 'equip': { const ec = c.cards.get(e.card); if (ec?.equip) d.dmg += (ec.equip.atk ?? 0) * Math.min(4, ec.equip.durability ?? 3); break; }
      case 'if': { addDE(d, effectsDE(e.then, vars), 0.55); if (e.else) addDE(d, effectsDE(e.else, vars), 0.45); break; }
      case 'repeat': addDE(d, effectsDE(e.effects, vars), val(e.times, vars)); break;
      case 'forEach': addDE(d, effectsDE(e.effects, vars), 1.5); break;
      case 'choose': addDE(d, effectsDE(e.options?.[0]?.effects ?? [], vars)); break;
      case 'move': d.util += 0.1; break;
      default: break;
    }
  }
  return d;
}

export interface CardVal { id: string; name: string; faction: string; rarity: string; type: string; cost: number; de: DE; value: number; perCost: number; utilShare: number }

export function cardValue(def: CardDef): CardVal {
  const vars = (def.vars ?? {}) as Record<string, number>;
  const d = zero();
  addDE(d, effectsDE(def.effects ?? [], vars));
  if (def.type === 'unit') addDE(d, unitDE(def.unit, vars));
  if (def.type === 'delay' && def.delay) addDE(d, judgeDE(def.delay.branches, vars, false, 0));
  if (def.type === 'equip' && def.equip) {
    const eq: Any = def.equip;
    if (eq.atk) d.dmg += eq.atk * Math.min(4, eq.durability ?? 3) * 0.85; // counter-damage eats ~15%
    for (const t of eq.triggers ?? []) addDE(d, effectsDE(t.effects, vars), triggerTimes(t.on));
    if (eq.modifiers?.length) d.util += 0.5 * eq.modifiers.length;
  }
  if (def.type === 'field' && def.field) {
    const f: Any = def.field;
    for (const t of f.triggers ?? []) addDE(d, effectsDE(t.effects, vars), Math.min(f.duration ?? 3, triggerTimes(t.on)));
    if (f.modifiers?.length) d.util += 0.6 * f.modifiers.length;
  }
  if ((def.keywords ?? []).includes('retain')) d.util += 0.1;
  const g = def.cost.g === 'X' ? 3 : def.cost.g;
  const cost = g + (def.cost.c?.length ?? 0);
  const value = total(d);
  return { id: def.id, name: def.name, faction: def.faction, rarity: def.rarity, type: def.type, cost, de: d, value, perCost: value / Math.max(cost, 0.5), utilShare: value > 0 ? (d.util * W_CARD) / value : 1 };
}

// ───────────── enemy-side pricing ─────────────
/** damage an enemy effect list deals to the player side, as DE (dmg = to commander, armor = self-protection, heal = self-heal) */
function moveEffectsDmgAsDE(effs: Any[], vars: Record<string, number>, atk: number): DE {
  const d = zero();
  for (const e of effs ?? []) {
    const t = e.target;
    const toPlayer = t === 'target' || t === 'enemyCommander' || t === 'allEnemies' || t === 'randomEnemy' || t === 'allCharacters';
    const toUnits = t === 'enemyUnits' || t === 'enemyFront';
    switch (e.op) {
      case 'attack': d.dmg += (e.amount !== undefined ? val(e.amount, vars, atk) : atk) * (val(e.times, vars, atk) || 1); break;
      case 'damage': { const n = val(e.amount, vars, atk) * (val(e.times, vars, atk) || 1); if (toPlayer) d.dmg += n; else if (toUnits) d.dmg += n * 0.3; break; }
      case 'status':
        if (toPlayer && e.status === 'burn') d.util += burnTotal(val(e.amount, vars, atk));
        else if (toPlayer && e.status === 'poison') d.util += poisonTotal(val(e.amount, vars, atk));
        else if (toPlayer && e.status === 'vulnerable') d.util += 3 * val(e.amount, vars, atk);
        else if (toPlayer && e.status === 'weak') d.util += 1.5 * val(e.amount, vars, atk);
        else if (e.status === 'might' && (t === 'self' || t === 'allFriendly')) d.util += 1.5 * val(e.amount, vars, atk);
        break;
      case 'armor': if (t === 'self' || t === 'commander' || t === 'friendlyUnits') d.armor += val(e.amount, vars, atk); break;
      case 'heal': d.heal += val(e.amount, vars, atk); break;
      case 'judge': addDE(d, judgeDE(e.branches, vars, true, atk)); break;
      case 'delay': { const dc = c.cards.get(e.card); if (dc?.delay) addDE(d, judgeDE(dc.delay.branches, (dc.vars ?? {}) as Record<string, number>, true, atk)); break; }
      case 'create': { const t2 = typeof e.card === 'string' ? c.cards.get(e.card) : undefined; if (t2 && (t2.type === 'status' || t2.type === 'curse')) d.util += 1.5 * val(e.n ?? 1, vars, atk); break; }
      case 'if': addDE(d, moveEffectsDmgAsDE(e.then, vars, atk), 0.5); if (e.else) addDE(d, moveEffectsDmgAsDE(e.else, vars, atk), 0.5); break;
      default: break;
    }
  }
  return d;
}

/** expected (weight of each move per turn) for an AI script */
function moveMix(ai: EnemyAI): Record<string, number> {
  if (ai.type === 'cycle') { const m: Record<string, number> = {}; for (const s of ai.sequence) m[s] = (m[s] ?? 0) + 1 / ai.sequence.length; return m; }
  if (ai.type === 'weighted') { const tot = Object.values(ai.weights).reduce((s, x) => s + x, 0); return Object.fromEntries(Object.entries(ai.weights).map(([k, w]) => [k, w / tot])); }
  return moveMix(ai.then);
}

interface EnemyProfile { id: string; name: string; hp: number; dpt: number; direct: number; side: number; armorPT: number; healPT: number; summonPT: { id: string; n: number }[]; castPT: number; key: boolean }

/** average damage a boss hand-cast produces (energy per cast / avg card cost × avg damage per card) */
function castValue(def: EnemyDef, atk: number): number {
  const deck = def.deck ?? [];
  if (!deck.length) return 0;
  let dm = 0, cost = 0;
  for (const id of deck) { const cd = c.cards.get(id); if (!cd) continue; const v = moveEffectsDmgAsDE([...(cd.effects ?? []), ...(cd.type === 'delay' ? [{ op: 'delay', card: id }] : [])], (cd.vars ?? {}) as Record<string, number>, atk); dm += v.dmg + v.util; cost += (cd.cost.g === 'X' ? 1 : cd.cost.g) + (cd.cost.c?.length ?? 0); }
  const avgCost = Math.max(1, cost / deck.length);
  const per = def.energy?.perTurn ?? 1;
  return Math.min(3, per / avgCost) * (dm / deck.length);
}

function enemyProfile(id: string, tune: { hp: number; dmg: number }, asc: number, key: boolean): EnemyProfile {
  const def = c.enemy(id);
  let hp = (def.hp[0] + def.hp[1]) / 2;
  let m = tune.hp;
  if (def.tier === 'normal' && asc >= 2) m += 0.1;
  if (def.tier === 'elite' && asc >= 3) m += 0.1;
  if (def.tier === 'boss' && asc >= 4) m += 0.1;
  hp = Math.round(hp * m);
  // phase blend: fraction of the fight spent in each phase ≈ HP fraction
  const phases: { ai: EnemyAI; moves: Record<string, Any>; atk: number; w: number }[] = [];
  const ph = def.phases ?? [];
  let prev = 1;
  phases.push({ ai: def.ai, moves: def.moves, atk: def.atk, w: 0 });
  for (const p of ph) {
    if (p.minAscension !== undefined && asc < p.minAscension) break;
    phases[phases.length - 1]!.w = prev - p.hpBelow;
    phases.push({ ai: p.ai, moves: { ...def.moves, ...(p.moves ?? {}) }, atk: p.atk ?? def.atk, w: 0 });
    prev = p.hpBelow;
  }
  phases[phases.length - 1]!.w = prev;
  let direct = 0, side = 0, armorPT = 0, healPT = 0, castPT = 0;
  const summonPT: Record<string, number> = {};
  for (const p of phases) {
    const mix = moveMix(p.ai);
    for (const [mv, w] of Object.entries(mix)) {
      const move = p.moves[mv];
      if (!move) continue;
      for (const e of move.effects) if (e.op === 'summon') summonPT[e.unit] = (summonPT[e.unit] ?? 0) + w * p.w * val(e.n ?? 1, {}, p.atk);
      if (move.effects.some((e: Any) => e.op === 'script' && e.id === 'bossCast')) { castPT += w * p.w * castValue(def, p.atk); continue; }
      const d = moveEffectsDmgAsDE(move.effects, {}, p.atk);
      direct += w * p.w * d.dmg; side += w * p.w * d.util; armorPT += w * p.w * d.armor; healPT += w * p.w * d.heal;
    }
  }
  // back-row melee units cannot attack until the front row opens up
  const melee = !(def.keywords ?? []).includes('ranged') && def.row === 'back';
  if (melee) direct *= 0.4;
  // difficulty table + A8 (+1 per hit for normal enemies; ~1 hit per turn)
  const dmgMul = tune.dmg;
  const a8 = asc >= 8 && def.tier === 'normal' && direct > 0 ? 1 : 0;
  const dpt = (direct + castPT) * dmgMul + a8 + side;
  return { id, name: def.name, hp, dpt, direct: direct * dmgMul + a8, side, armorPT, healPT, summonPT: Object.entries(summonPT).map(([k, n]) => ({ id: k, n })), castPT: castPT * dmgMul, key };
}

// ───────────── player output (Monte Carlo over shuffles) ─────────────
interface Stage { label: string; picks: number; upgrades: number }
const STAGES: Stage[] = [
  { label: '起始牌组', picks: 0, upgrades: 0 },
  { label: '+3 张', picks: 3, upgrades: 0 },
  { label: '+8 张', picks: 8, upgrades: 1 },
  { label: '+14 张（第2幕外推）', picks: 14, upgrades: 3 },
  { label: '+20 张（第3幕外推）', picks: 20, upgrades: 5 },
];

/** per-commander skill + starter relic contribution per turn, hand-priced from their rules text */
const SKILL_PT: Record<string, { dmg: number; armor: number; note: string }> = {
  r_huojin: { dmg: 7, armor: 0, note: '断焰刀 3 攻×4 次 + 每击 2 灼烧；引焰入锋 1 源 ≈ 攻击力+灼烧' },
  r_liyuan: { dmg: 3.5, armor: 1.5, note: '每献 3 伤；第 4 献觉醒回 8 并多献 1 次' },
  b_shiyun: { dmg: 4, armor: 4, note: '护甲留存 ≤10（护甲利用率大增）；山君一怒 2 源 = 护甲/2 伤害；石心 6 甲 + 1 坚韧' },
  b_suxian: { dmg: 1, armor: 3, note: '余烬 +1、应对得余音；冰蚕弦每次应对 3 甲' },
  g_qingsi: { dmg: 2.5, armor: 1.5, note: '开场灵苗 + 灵母低语 1 源召唤灵苗；≥3 单位抽 1' },
  g_acang: { dmg: 3, armor: 2, note: '开场山魅；单位死亡 +1/+1；首次死亡抽 1' },
  y_xuanji: { dmg: 2, armor: 1, note: '司天观星 2 → 判定牌可选阳/阴约 +25% 判定收益；开场命签' },
  y_yanwujiu: { dmg: 2.5, armor: 0, note: '每张延时每回合 2 伤；首次延时抽 1' },
  p_yetan: { dmg: 5, armor: 0, note: '第 3 张牌 3 毒/回合（叠加）；罗刹引 1+P 源 = 中毒层数；昙香囊毒伤 +1' },
  p_liuxu: { dmg: 1.5, armor: 0.5, note: '絮影、换面发现；柳絮扇手牌 +2、开场抽 2' },
};

function sampleReward(rng: RngState, pool: CardVal[]): CardVal {
  const roll = rand(rng) * 100;
  const rarity = roll >= 99 ? 'legendary' : roll >= 92 ? 'epic' : roll >= 62 ? 'rare' : 'common';
  const opts: CardVal[] = [];
  for (let i = 0; i < 3; i++) {
    const p = pool.filter((x) => x.rarity === rarity && !opts.includes(x));
    const q = p.length ? p : pool;
    opts.push(q[Math.floor(rand(rng) * q.length)]!);
  }
  // the simulator bot picks by rarity; a human picks by value. Model the human-ish pick (best DE) but only among modelled cards
  return opts.sort((a, b) => b.value - a.value)[0]!;
}

interface Output { dmg: number[]; armor: number[]; aoe: number[]; sources: number[]; cards: number[] }

function simulateOutput(deck: CardVal[], turns: number, rng: RngState, skill: { dmg: number; armor: number }): Output {
  const out: Output = { dmg: [], armor: [], aoe: [], sources: [], cards: [] };
  let draw = shuffle(rng, [...deck]);
  let discard: CardVal[] = [];
  let sources = 3 - (ASC >= 11 ? 1 : 0);
  const pull = () => { if (!draw.length) { draw = shuffle(rng, discard); discard = []; } return draw.pop(); };
  for (let t = 0; t < turns; t++) {
    const hand: CardVal[] = [];
    for (let i = 0; i < 5; i++) { const x = pull(); if (x) hand.push(x); }
    hand.sort((a, b) => a.value - b.value);
    if (sources < 7 && hand.length) { hand.shift(); sources = Math.min(10, sources + 1); }
    let budget = sources, dmg = skill.dmg, armor = skill.armor, aoe = 0, played = 0;
    const ranked = [...hand].sort((a, b) => b.perCost - a.perCost);
    for (const cv of ranked) {
      if (cv.cost > budget) { discard.push(cv); continue; }
      budget -= cv.cost; played++;
      dmg += cv.de.dmg; aoe += cv.de.aoe; armor += (cv.de.armor + cv.de.heal) * W_ARMOR / 0.8 * 0.8;
      // draws: pull more cards and value them at their own DE (no extra cost check — cheap cantrip chains)
      for (let k = 0; k < Math.floor(cv.de.util); k++) { const x = pull(); if (x && x.cost <= budget) { budget -= x.cost; dmg += x.de.dmg; aoe += x.de.aoe; armor += x.de.armor + x.de.heal; discard.push(x); } else if (x) discard.push(x); }
      discard.push(cv);
    }
    out.dmg.push(dmg); out.armor.push(armor); out.aoe.push(aoe); out.sources.push(sources); out.cards.push(played);
  }
  return out;
}

interface PlayerCurve { cmd: string; stage: string; dmg: number[]; armor: number[]; aoe: number[]; sources: number[]; cards: number[]; dmgPerSource: number; armorPerSource: number }

function playerCurves(cmdId: string): PlayerCurve[] {
  const cmd = c.commander(cmdId);
  const pool = c.filterCards({ faction: [cmd.faction, 'N'] as Any }, [cmd.faction]).filter((d) => d.pool !== false && !['basic', 'token', 'special'].includes(d.rarity)).map(cardValue).filter((v) => v.utilShare < 0.6);
  const starter = cmd.deck.map((id) => cardValue(c.card(id)));
  if (ASC >= 10 && c.cards.has('cu_suye')) starter.push({ ...cardValue(c.card('cu_suye')), value: 0, perCost: 0, de: zero(), cost: 99 });
  const res: PlayerCurve[] = [];
  const TURNS = 8, N = 150;
  for (const st of STAGES) {
    const acc: Output = { dmg: Array(TURNS).fill(0), armor: Array(TURNS).fill(0), aoe: Array(TURNS).fill(0), sources: Array(TURNS).fill(0), cards: Array(TURNS).fill(0) };
    for (let k = 0; k < N; k++) {
      const rng = seedRng(`model/${cmdId}/${st.label}/${k}`);
      const deck = [...starter];
      for (let i = 0; i < st.picks; i++) deck.push(sampleReward(rng, pool));
      // upgrades ≈ +40% on the best cards; shop removal of 1 basic per 8 picks
      deck.sort((a, b) => b.value - a.value);
      for (let i = 0; i < st.upgrades && i < deck.length; i++) { const d = deck[i]!; deck[i] = { ...d, de: { ...d.de, dmg: d.de.dmg * 1.4, armor: d.de.armor * 1.4, aoe: d.de.aoe * 1.4 }, value: d.value * 1.4, perCost: d.perCost * 1.4 }; }
      for (let i = 0; i < Math.floor(st.picks / 8); i++) { const j = deck.findIndex((x) => c.card(x.id).rarity === 'basic' && x.de.armor > 0); if (j >= 0) deck.splice(j, 1); }
      const o = simulateOutput(deck, TURNS, rng, SKILL_PT[cmdId] ?? { dmg: 0, armor: 0 });
      for (const key of ['dmg', 'armor', 'aoe', 'sources', 'cards'] as const) for (let t = 0; t < TURNS; t++) acc[key][t]! += o[key][t]! / N;
    }
    const spent = acc.sources.reduce((s, x) => s + x, 0);
    res.push({ cmd: cmdId, stage: st.label, ...acc, dmgPerSource: (acc.dmg.reduce((s, x) => s + x, 0) + acc.aoe.reduce((s, x) => s + x, 0) * AOE_TARGETS) / spent, armorPerSource: acc.armor.reduce((s, x) => s + x, 0) / spent });
  }
  return res;
}

// ───────────── fight model ─────────────
interface FightResult { turns: number; hpLoss: number; effHp: number; dpt0: number }

function fight(enc: EncounterDef, curve: PlayerCurve, asc: number, unitsBlock = 0): FightResult {
  const tune = encounterTune(enc.id);
  const bossFight = enc.tier !== 'normal';
  const foes = enc.enemies.map((e, i) => enemyProfile(e.id, tune, asc, !bossFight || i === 0));
  // A14: every enemy starts with one ward → the first hit on each is wasted (~one card each)
  const wardPad = asc >= 14 ? 6 : 0;
  const alive = foes.map((f) => ({ f, hp: f.hp + wardPad }));
  let hpLoss = 0, t = 0, effHp = 0;
  const minions: { f: EnemyProfile; hp: number }[] = [];
  const summonAcc: Record<string, number> = {};
  for (; t < 40; t++) {
    const T = Math.min(t, curve.dmg.length - 1);
    // armor/heal the enemies gained last turn shields this turn's damage
    let pool = curve.dmg[T]!;
    const aoe = curve.aoe[T]!;
    const all = [...alive, ...minions].filter((x) => x.hp > 0);
    for (const x of all) { x.hp -= aoe; }
    // focus: minions/non-key first when they deal damage, lowest HP first, key target last in boss fights
    const order = [...alive, ...minions].filter((x) => x.hp > 0).sort((a, b) => (a.f.key && bossFight ? 1 : 0) - (b.f.key && bossFight ? 1 : 0) || a.hp - b.hp);
    for (const x of order) { if (pool <= 0) break; const hit = Math.min(pool, x.hp); x.hp -= hit; pool -= hit; }
    const living = [...alive, ...minions].filter((x) => x.hp > 0);
    if (bossFight ? !alive.some((x) => x.f.key && x.hp > 0) : !living.length) { t++; break; }
    // enemy turn
    let dmg = 0;
    for (const x of living) {
      dmg += x.f.dpt;
      x.hp += x.f.armorPT * 0.8 + x.f.healPT; effHp += x.f.armorPT * 0.8 + x.f.healPT;
      for (const s of x.f.summonPT) {
        summonAcc[s.id] = (summonAcc[s.id] ?? 0) + s.n;
        while (summonAcc[s.id]! >= 1 && minions.filter((m) => m.hp > 0).length < 4) { summonAcc[s.id]! -= 1; const mp = enemyProfile(s.id, tune, asc, false); minions.push({ f: mp, hp: mp.hp }); effHp += mp.hp; }
      }
    }
    hpLoss += Math.max(0, dmg - curve.armor[T]! - unitsBlock);
  }
  effHp += foes.reduce((s, f) => s + f.hp + wardPad, 0);
  return { turns: t, hpLoss, effHp, dpt0: foes.reduce((s, f) => s + f.dpt, 0) };
}

// ───────────── map / HP budget ─────────────
function mapStats(act: number) {
  const N = 200;
  const cnt: Record<string, number> = {};
  for (let k = 0; k < N; k++) {
    const m = generateMap(`model/map/${act}/${k}`, { act, hasLieutenant: act > 2, ascension: ASC });
    // walk a path using the simulator's preferences at ~60% HP
    let pos: { row: number; col: number } | null = null;
    for (let row = 0; row < m.rows.length; row++) {
      const opts: MapNode[] = pos ? (m.rows[row - 1]!.find((n) => n.col === pos!.col)?.next ?? []).map((cc) => m.rows[row]!.find((n) => n.col === cc)!).filter(Boolean) : m.rows[0]!;
      const pref = (t: string) => ({ camp: 6, elite: 3, shop: 2, combat: 4, event: 4, chest: 8, recruit: 5, stargaze: 3 } as Record<string, number>)[t] ?? 1;
      const best: MapNode = [...opts].sort((a, b) => pref(b.type) - pref(a.type) || a.col - b.col)[0]!;
      cnt[best.type] = (cnt[best.type] ?? 0) + 1 / N;
      pos = { row, col: best.col };
    }
  }
  return cnt;
}

// ───────────── report ─────────────
const md: string[] = [];
const cmds = [...c.commanders.keys()];
const f1 = (x: number) => x.toFixed(1);
const f0 = (x: number) => x.toFixed(0);
const avgHp = cmds.reduce((s, id) => s + c.commander(id).hp, 0) / cmds.length * (ASC >= 6 ? 0.9 : 1);
md.push(`# 难度模型（逆命 ${ASC}）`, '', `玩家平均生命 ${f1(avgHp)}；DE = 伤害当量（护甲 ×${W_ARMOR}，每张额外抽牌 ≈ ${W_CARD}，AoE ×${AOE_TARGETS}）。`, '');

// enemies per encounter
const encs = [...c.encounters.values()].filter((e) => (e.weight ?? 1) > 0 && e.id !== 'sandbox').sort((a, b) => a.act - b.act || a.tier.localeCompare(b.tier) || a.id.localeCompare(b.id));
const encRows = encs.map((e) => {
  const tune = encounterTune(e.id);
  const bossFight = e.tier !== 'normal';
  const ps = e.enemies.map((x, i) => enemyProfile(x.id, tune, ASC, !bossFight || i === 0));
  const hp = ps.reduce((s, p) => s + p.hp, 0);
  const dpt = ps.reduce((s, p) => s + p.dpt, 0);
  const tier = e.tier === 'normal' ? (e.pool === 'easy' ? 'easy' : 'normal') : e.tier;
  return { e, tier, hp, dpt, pctHp: dpt / avgHp, armor: ps.reduce((s, p) => s + p.armorPT + p.healPT, 0) };
});
md.push('## 敌方：每遭遇战的生命与每回合期望伤害（已含 tuning 与逆命）', '', '| 幕 | 层级 | 场数 | 平均总生命 | 每回合伤害 | 占玩家生命% | 每回合护甲/治疗 | 最高者 |', '|---|---|---|---|---|---|---|---|');
for (const act of [1, 2, 3, 4]) for (const tier of ['easy', 'normal', 'elite', 'boss']) {
  const rs = encRows.filter((r) => r.e.act === act && r.tier === tier);
  if (!rs.length) continue;
  const top = [...rs].sort((a, b) => b.dpt - a.dpt)[0]!;
  md.push(`| ${act} | ${tier} | ${rs.length} | ${f0(rs.reduce((s, r) => s + r.hp, 0) / rs.length)} | ${f1(rs.reduce((s, r) => s + r.dpt, 0) / rs.length)} | ${f0(100 * rs.reduce((s, r) => s + r.pctHp, 0) / rs.length)}% | ${f1(rs.reduce((s, r) => s + r.armor, 0) / rs.length)} | ${top.e.id} ${f1(top.dpt)} |`);
}

// player curves
const curves: Record<string, PlayerCurve[]> = {};
for (const id of cmds) curves[id] = playerCurves(id);
md.push('', '## 玩家：各主帅每回合期望产出（第 1–4 回合平均 / 第 5–8 回合平均）', '', '| 主帅 | 生命 | 阶段 | 伤害/回合 | AoE/回合 | 护甲/回合 | 源（第1/4/8回合） | 出牌/回合 | 伤害/源 | 护甲/源 |', '|---|---|---|---|---|---|---|---|---|---|');
const avg = (a: number[], i: number, j: number) => a.slice(i, j).reduce((s, x) => s + x, 0) / (j - i);
for (const id of cmds) for (const cv of curves[id]!) {
  if (!['起始牌组', '+8 张', '+20 张（第3幕外推）'].includes(cv.stage)) continue;
  md.push(`| ${c.commander(id).name} | ${c.commander(id).hp} | ${cv.stage} | ${f1(avg(cv.dmg, 0, 4))} / ${f1(avg(cv.dmg, 4, 8))} | ${f1(avg(cv.aoe, 0, 8))} | ${f1(avg(cv.armor, 0, 4))} / ${f1(avg(cv.armor, 4, 8))} | ${f1(cv.sources[0]!)}/${f1(cv.sources[3]!)}/${f1(cv.sources[7]!)} | ${f1(avg(cv.cards, 0, 8))} | ${cv.dmgPerSource.toFixed(2)} | ${cv.armorPerSource.toFixed(2)} |`);
}

// fights per act: which deck stage meets which tier
const stageFor = (act: number, tier: string) => act === 1 ? (tier === 'easy' ? 0 : tier === 'normal' ? 1 : 2) : act === 2 ? (tier === 'boss' ? 3 : 2) : act === 3 ? (tier === 'boss' ? 4 : 3) : 4;
const tierRows: { act: number; tier: string; cmd: string; turns: number; loss: number }[] = [];
for (const id of cmds) for (const r of encRows) {
  const st = stageFor(r.e.act, r.tier);
  const fr = fight(r.e, curves[id]![st]!, ASC);
  tierRows.push({ act: r.e.act, tier: r.tier, cmd: id, turns: fr.turns, loss: fr.hpLoss });
}
md.push('', '## 预期战斗：击杀回合与失血（所有主帅平均；牌组阶段：第1幕简单=起始、普通=+3、精英/首领=+8；第2幕=+8/+14；第3幕=+14/+20）', '', '| 幕 | 层级 | 击杀回合 | 失血 | 失血占生命% |', '|---|---|---|---|---|');
const tierAvg: Record<string, number> = {};
for (const act of [1, 2, 3, 4]) for (const tier of ['easy', 'normal', 'elite', 'boss']) {
  const rs = tierRows.filter((r) => r.act === act && r.tier === tier);
  if (!rs.length) continue;
  const loss = rs.reduce((s, r) => s + r.loss, 0) / rs.length;
  tierAvg[`${act}:${tier}`] = loss;
  md.push(`| ${act} | ${tier} | ${f1(rs.reduce((s, r) => s + r.turns, 0) / rs.length)} | ${f1(loss)} | ${f0((100 * loss) / avgHp)}% |`);
}

// HP budget per act
md.push('', '## 每幕生命预算（沿模拟器偏好路径的期望节点数）', '', '| 幕 | 普通战 | 精英 | 营地 | 事件 | 商店 | 预期总失血 | 营地回复（半数用于休息） | 预算余量（入幕满血） |', '|---|---|---|---|---|---|---|---|---|');
for (const act of [1, 2, 3]) {
  const ms = mapStats(act);
  const combats = (ms.combat ?? 0);
  const easyN = Math.min(3, combats), hardN = Math.max(0, combats - 3);
  const loss = easyN * (tierAvg[`${act}:easy`] ?? 0) + hardN * (tierAvg[`${act}:normal`] ?? 0) + (ms.elite ?? 0) * (tierAvg[`${act}:elite`] ?? 0) + (tierAvg[`${act}:boss`] ?? 0);
  const heal = (ms.camp ?? 0) * 0.5 * avgHp * 0.3 + avgHp * 0.3; // the pre-boss camp row is always a rest
  const entry = act === 1 ? avgHp : avgHp * (ASC >= 5 ? 0.85 : 1);
  md.push(`| ${act} | ${f1(combats)} | ${f1(ms.elite ?? 0)} | ${f1(ms.camp ?? 0)} | ${f1(ms.event ?? 0)} | ${f1(ms.shop ?? 0)} | ${f0(loss)} | ${f0(heal)} | ${f0(entry + heal - loss)} |`);
}

// commander comparison on act-1 content
md.push('', '## 主帅：第1幕全部遭遇战的平均失血（相对均值）', '', '| 主帅 | 生命 | 第1幕平均失血/场 | 首领失血 | 相对 |', '|---|---|---|---|---|');
const cmdLoss = cmds.map((id) => {
  const rs = tierRows.filter((r) => r.cmd === id && r.act === 1);
  const boss = tierRows.filter((r) => r.cmd === id && r.act === 1 && r.tier === 'boss');
  return { id, loss: rs.reduce((s, r) => s + r.loss, 0) / rs.length / c.commander(id).hp, boss: boss.reduce((s, r) => s + r.loss, 0) / boss.length };
});
const meanLoss = cmdLoss.reduce((s, x) => s + x.loss, 0) / cmdLoss.length;
for (const x of cmdLoss) md.push(`| ${c.commander(x.id).name} | ${c.commander(x.id).hp} | ${f0(100 * x.loss)}% | ${f1(x.boss)} | ${f0((100 * (x.loss - meanLoss)) / meanLoss)}% |`);

// outliers
md.push('', '## 离群项', '');
const act1Norm = encRows.filter((r) => r.e.act === 1 && r.tier !== 'boss');
md.push('### 遭遇战（每回合伤害超过同幕同层级中位数 1.5 倍，或第1幕非首领 >15% 玩家生命）', '');
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)]! : 0; };
for (const r of encRows) {
  const peers = encRows.filter((p) => p.e.act === r.e.act && p.tier === r.tier);
  const med = median(peers.map((p) => p.dpt));
  const hpMed = median(peers.map((p) => p.hp));
  const flags: string[] = [];
  if (r.dpt > med * 1.5) flags.push(`伤害 ${f1(r.dpt)} ≥ 1.5×中位 ${f1(med)}`);
  if (r.hp > hpMed * 1.5) flags.push(`生命 ${f0(r.hp)} ≥ 1.5×中位 ${f0(hpMed)}`);
  if (act1Norm.includes(r) && r.pctHp > 0.15) flags.push(`第1幕每回合 ${f0(100 * r.pctHp)}% 生命`);
  if (flags.length) md.push(`- ${r.e.id}（${r.e.act}幕 ${r.tier}）：${flags.join('；')}`);
}
md.push('', '### 卡牌（DE/费 偏离同稀有度中位数；仅统计效用占比 <50% 的卡）', '');
const allCards = [...c.cards.values()].filter((d) => d.pool !== false && ['common', 'rare', 'epic', 'legendary'].includes(d.rarity)).map(cardValue);
const rarMed: Record<string, number> = {};
for (const r of ['common', 'rare', 'epic', 'legendary']) rarMed[r] = median(allCards.filter((x) => x.rarity === r && x.utilShare < 0.5).map((x) => x.perCost));
md.push(`中位 DE/费：普通 ${f1(rarMed.common!)} · 稀有 ${f1(rarMed.rare!)} · 史诗 ${f1(rarMed.epic!)} · 传说 ${f1(rarMed.legendary!)}`, '');
for (const x of allCards.filter((x) => x.utilShare < 0.5).sort((a, b) => b.perCost / rarMed[b.rarity]! - a.perCost / rarMed[a.rarity]!)) {
  const k = x.perCost / rarMed[x.rarity]!;
  if (k >= 1.9 || k <= 0.45) md.push(`- ${k >= 1 ? '偏强' : '偏弱'} ${x.name}（${x.faction} ${x.rarity} ${x.type} 费${x.cost}）：DE ${f1(x.value)}，${f1(x.perCost)}/费 = ${k.toFixed(2)}×中位`);
}
fs.mkdirSync('.cache/sim', { recursive: true });
const out = args.md ?? '.cache/sim/model.md';
fs.writeFileSync(out, md.join('\n') + '\n');
console.log(md.join('\n'));
