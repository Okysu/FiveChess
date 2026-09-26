/** Live card values for display: effective cost, affordability, missing colors, modified numbers. */
import type { CombatState, CardInst, Unit } from '../../../engine/combat/state';
import { cardDef, effectiveCost, planPayment, calcDamage } from '../../../engine/combat/core';
import { evalValue } from '../../../engine/combat/eval';
import { commanderOf, sumMods } from '../../../engine/combat/board';
import type { CardDef, Color, Value } from '../../../engine/defs';
import type { CardLive } from '../../ui/card';
import type { VarInfo } from '../../ui/richtext';

export function liveCard(s: CombatState, card: CardInst, inWindow = false): CardLive {
  const def = cardDef(card);
  const need = effectiveCost(s, card);
  const plan = planPayment(s, need, card);
  const missing: Color[] = [];
  if (!plan) {
    const ready = s.sources.filter((x) => x.ready);
    const pool = [...ready];
    for (const c of need.c) {
      const i = pool.findIndex((x) => x.color === c);
      if (i >= 0) pool.splice(i, 1); else missing.push(c);
    }
  }
  const vars: Record<string, VarInfo> = {};
  const pc = commanderOf(s, 'player');
  const live = liveVars(def);
  for (const [k, base] of Object.entries(def.vars ?? {})) {
    const kind = def.varKinds?.[k] === live.get(k) ? live.get(k) : undefined;
    let value = base;
    if (pc && kind === 'attack') value = previewAttackValue(s, pc, base);
    else if (pc && kind === 'armor') value = Math.max(0, base + (pc.statuses.tenacity ?? 0) + sumMods(s, 'armorGain', 'player', pc));
    else if (pc && kind === 'heal') value = Math.max(0, base + sumMods(s, 'healing', 'player', pc));
    vars[k] = { value, base };
  }
  void inWindow;
  return { cost: { g: need.g, c: need.c, x: need.x }, payable: !!plan, missing, vars };
}

type LiveKind = 'attack' | 'armor' | 'heal';
const liveCache = new WeakMap<CardDef, Map<string, LiveKind>>();
/**
 * Which vars are the amount of a hit / armor gain / heal, so the buffs that change that amount apply to them.
 * Everything else keeps its printed value: a weapon's "+{a} attack" (a stat change, not a hit) and the step in
 * "+{k} per red source" (buffs apply once to the total, not to every step).
 */
function liveVars(def: CardDef): Map<string, LiveKind> {
  let out = liveCache.get(def);
  if (out) return out;
  const found = new Map<string, LiveKind>();
  const amountVars = (v: unknown, kind: LiveKind) => {
    if (typeof v === 'string') { if (v.startsWith('$')) found.set(v.slice(1), kind); return; }
    if (v && typeof v === 'object' && 'add' in v) for (const x of (v as { add: unknown[] }).add) amountVars(x, kind);
  };
  const walk = (n: unknown) => {
    if (Array.isArray(n)) { for (const x of n) walk(x); return; }
    if (!n || typeof n !== 'object') return;
    const o = n as Record<string, unknown>;
    if (o.op === 'damage' || o.op === 'attack') amountVars(o.amount, 'attack');
    else if (o.op === 'armor') amountVars(o.amount, 'armor');
    else if (o.op === 'heal') amountVars(o.amount, 'heal');
    for (const x of Object.values(o)) walk(x);
  };
  walk([def.effects, def.unit, def.equip, def.field, def.delay]);
  out = found;
  liveCache.set(def, out);
  return out;
}

/** attack damage before target modifiers (might, weak, attackDamage mods) */
export function previewAttackValue(s: CombatState, src: Unit, base: number): number {
  let amt = base + (src.statuses.might ?? 0) + sumMods(s, 'attackDamage', src.side, src);
  if ((src.statuses.weak ?? 0) > 0) amt *= 0.75;
  return Math.max(0, Math.floor(amt));
}

/** predicted damage of a card's direct 'target' damage effects against a unit */
export function predictCardDamage(s: CombatState, card: CardInst, target: Unit): number | null {
  const def = cardDef(card);
  const pc = commanderOf(s, 'player');
  const ctx = { side: 'player' as const, source: pc?.uid ?? null, kind: 'card' as const, card, defId: card.id, up: card.up, target: target.uid, vars: def.vars ?? {}, x: 0 };
  // formulas ("+1 per red source", "per card played") are evaluated against the current board
  const val = (v: Value | undefined, dflt: number) => { if (v === undefined) return dflt; try { return evalValue(s, v, ctx); } catch { return dflt; } };
  let total = 0;
  let found = false;
  for (const e of def.effects ?? []) {
    if (e.op === 'damage' && (e.target === 'target')) {
      total += calcDamage(s, pc, target, val(e.amount, 0), 'effect', !!e.attack) * val(e.times, 1);
      found = true;
    }
  }
  return found ? total : null;
}
