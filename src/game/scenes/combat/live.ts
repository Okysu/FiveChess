/** Live card values for display: effective cost, affordability, missing colors, modified numbers. */
import type { CombatState, CardInst, Unit } from '../../../engine/combat/state';
import { cardDef, effectiveCost, planPayment, calcDamage } from '../../../engine/combat/core';
import { commanderOf, sumMods } from '../../../engine/combat/board';
import type { Color } from '../../../engine/defs';
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
  for (const [k, base] of Object.entries(def.vars ?? {})) {
    const kind = def.varKinds?.[k];
    let value = base;
    if (pc && kind === 'attack') value = previewAttackValue(s, pc, base);
    else if (pc && kind === 'armor') value = Math.max(0, base + (pc.statuses.tenacity ?? 0) + sumMods(s, 'armorGain', 'player', pc));
    else if (pc && kind === 'heal') value = Math.max(0, base + sumMods(s, 'healing', 'player', pc));
    vars[k] = { value, base };
  }
  void inWindow;
  return { cost: { g: need.g, c: need.c, x: need.x }, payable: !!plan, missing, vars };
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
  let total = 0;
  let found = false;
  for (const e of def.effects ?? []) {
    if (e.op === 'damage' && (e.target === 'target')) {
      const base = typeof e.amount === 'number' ? e.amount : typeof e.amount === 'string' ? def.vars?.[e.amount.slice(1)] ?? 0 : 0;
      const times = typeof e.times === 'number' ? e.times : 1;
      total += calcDamage(s, pc, target, base, 'effect', !!e.attack) * times;
      found = true;
    }
  }
  return found ? total : null;
}
