/** Value expressions, selectors and conditions of the effect DSL. */
import type { Condition, Selector, SelectorQuery, Value, Suit } from '../defs';
import { YANG } from '../defs';
import { rand, shuffle } from '../rng';
import type { CombatState, Ctx, Unit } from './state';
import { other } from './state';
import { adjacentUnits, alive, atkOf, commanderOf, hasKw, maxHpOf, unit, unitsOf } from './board';
import { content, matchCard } from '../content';

export function evalValue(s: CombatState, v: Value, ctx: Ctx): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const key = v.slice(1);
    if (key === 'x') return ctx.x ?? 0;
    const n = ctx.vars[key];
    if (n === undefined) throw new Error(`unknown var ${v}`);
    return n;
  }
  if ('add' in v) return v.add.reduce<number>((a, b) => a + evalValue(s, b, ctx), 0);
  if ('mul' in v) return Math.floor(v.mul.reduce<number>((a, b) => a * evalValue(s, b, ctx), 1));
  if ('sub' in v) return evalValue(s, v.sub[0], ctx) - evalValue(s, v.sub[1], ctx);
  if ('div' in v) { const d = evalValue(s, v.div[1], ctx); return d === 0 ? 0 : Math.floor(evalValue(s, v.div[0], ctx) / d); }
  if ('max' in v) return Math.max(...v.max.map((x) => evalValue(s, x, ctx)));
  if ('min' in v) return Math.min(...v.min.map((x) => evalValue(s, x, ctx)));
  const side = v.side === 'enemy' ? other(ctx.side) : ctx.side;
  const one = (): Unit | undefined => (v.of ? select(s, v.of, ctx)[0] : unit(s, ctx.source));
  switch (v.count) {
    case 'hand': return ctx.side === 'player' ? s.hand.length : s.sides.enemy.hand.length;
    case 'drawPile': return s.draw.length;
    case 'discardPile': return s.discard.length;
    case 'exhaustPile': return s.exhaust.length;
    case 'sources': return s.sources.filter((x) => !x.temp && (!v.color || x.color === v.color)).length;
    case 'readySources': return s.sources.filter((x) => x.ready).length;
    case 'embers': return s.active === 'enemy' ? s.sources.filter((x) => x.ready).length : 0;
    case 'units': return unitsOf(s, side).filter((u) => !v.row || u.row === v.row).length;
    case 'cardsPlayed': return s.cardsPlayedThisTurn;
    case 'status': { const u = one(); return u && v.status ? u.statuses[v.status] ?? 0 : 0; }
    case 'armor': return one()?.armor ?? 0;
    case 'atk': { const u = one(); return u ? atkOf(s, u) : 0; }
    case 'hp': return one()?.hp ?? 0;
    case 'maxHp': { const u = one(); return u ? maxHpOf(s, u) : 0; }
    case 'missingHp': { const u = one(); return u ? maxHpOf(s, u) - u.hp : 0; }
    case 'signs': return ctx.side === 'player' ? s.fate.signs.length : s.sides.enemy.signs.length;
    case 'judgeRank': return ctx.judge?.rank ?? 0;
    case 'x': return ctx.x ?? 0;
    case 'lastDamage': return ctx.lastDamage ?? 0;
    case 'turn': return s.turn;
    case 'sacrificed': return s.sacrificed.length;
    case 'eventAmount': return ctx.event?.amount ?? 0;
    case 'judgesThisTurn': {
      const j = s.stats.judgesThisTurn;
      if (!v.suit) return Object.values(j).reduce((a, b) => a + (b ?? 0), 0);
      const suits: Suit[] = v.suit === 'yang' ? [...YANG] : v.suit === 'yin' ? ['moon', 'mountain'] : [v.suit];
      return suits.reduce((a, b) => a + (j[b] ?? 0), 0);
    }
    case 'equipped': return Object.values(s.sides[side].equip).filter(Boolean).length;
    case 'delays': return one()?.delays.length ?? 0;
    case 'counter': {
      if (ctx.owner?.kind === 'relic') return s.relics.find((r) => r.id === ctx.owner!.ref)?.counter ?? 0;
      if (ctx.owner?.kind === 'unit') return unit(s, ctx.owner.ref as number)?.counter ?? 0;
      return 0;
    }
    case 'deadThisCombat': return s.stats.dead;
    case 'responsesThisCombat': return s.stats.responses;
    case 'weaponAtk': {
      const w = s.sides[side].equip.weapon;
      return w ? (content().card(w.card, w.up).equip?.atk ?? 0) + w.atkBonus : 0;
    }
    case 'selected': return ctx.selected ?? 0;
  }
}

function sideUnits(s: CombatState, side: 'friendly' | 'enemy' | 'both', ctx: Ctx, kind: 'unit' | 'character' | 'commander'): Unit[] {
  const sides = side === 'both' ? [ctx.side, other(ctx.side)] : side === 'friendly' ? [ctx.side] : [other(ctx.side)];
  const out: Unit[] = [];
  for (const sd of sides) {
    if (kind === 'commander') { const c = commanderOf(s, sd); if (alive(c)) out.push(c); }
    else out.push(...unitsOf(s, sd, kind === 'character'));
  }
  return out;
}

/** targeting by the opposing side cannot pick stealthed units */
function visible(ctx: Ctx, list: Unit[]): Unit[] {
  return list.filter((u) => !(u.stealth && u.side !== ctx.side));
}

export function select(s: CombatState, sel: Selector, ctx: Ctx): Unit[] {
  if (typeof sel === 'object') return selectQuery(s, sel, ctx);
  const one = (id: number | null | undefined) => { const u = unit(s, id ?? null); return alive(u) ? [u] : []; };
  switch (sel) {
    case 'none': return [];
    case 'self': return one(ctx.source);
    case 'commander': return one(s.sides[ctx.side].commander);
    case 'enemyCommander': return one(s.sides[other(ctx.side)].commander);
    case 'target': return one(ctx.target);
    case 'it': return one(ctx.it);
    case 'eventSource': return one(ctx.event?.source);
    case 'eventTarget': return one(ctx.event?.target);
    case 'declaredActor': return one(ctx.declared?.actor);
    case 'declaredTarget': return one(ctx.declared?.target);
    case 'adjacent': { const u = unit(s, ctx.source); return u ? adjacentUnits(s, u) : []; }
    case 'targetAdjacent': { const u = unit(s, ctx.target); return u ? adjacentUnits(s, u) : []; }
    case 'allEnemies': return sideUnits(s, 'enemy', ctx, 'character');
    case 'enemyUnits': return sideUnits(s, 'enemy', ctx, 'unit');
    case 'friendlyUnits': return sideUnits(s, 'friendly', ctx, 'unit');
    case 'otherFriendlyUnits': return sideUnits(s, 'friendly', ctx, 'unit').filter((u) => u.uid !== ctx.source);
    case 'allFriendly': return sideUnits(s, 'friendly', ctx, 'character');
    case 'allUnits': return sideUnits(s, 'both', ctx, 'unit');
    case 'allCharacters': return sideUnits(s, 'both', ctx, 'character');
    case 'randomEnemy': return pickRandom(s, visible(ctx, sideUnits(s, 'enemy', ctx, 'character')), 1);
    case 'randomEnemyUnit': return pickRandom(s, visible(ctx, sideUnits(s, 'enemy', ctx, 'unit')), 1);
    case 'randomFriendlyUnit': return pickRandom(s, sideUnits(s, 'friendly', ctx, 'unit'), 1);
    case 'enemyFront': return sideUnits(s, 'enemy', ctx, 'unit').filter((u) => u.row === 'front');
    case 'enemyBack': return sideUnits(s, 'enemy', ctx, 'unit').filter((u) => u.row === 'back');
    case 'friendlyFront': return sideUnits(s, 'friendly', ctx, 'unit').filter((u) => u.row === 'front');
    case 'friendlyBack': return sideUnits(s, 'friendly', ctx, 'unit').filter((u) => u.row === 'back');
  }
}

function pickRandom(s: CombatState, list: Unit[], n: number): Unit[] {
  if (list.length <= n) return list;
  return shuffle(s.rng, [...list]).slice(0, n);
}

function selectQuery(s: CombatState, q: SelectorQuery, ctx: Ctx): Unit[] {
  let list = sideUnits(s, q.side, ctx, q.kind ?? 'unit');
  if (q.side !== 'friendly') list = visible(ctx, list);
  if (q.row) list = list.filter((u) => u.row === q.row);
  if (q.notSelf) list = list.filter((u) => u.uid !== ctx.source);
  if (q.where) list = list.filter((u) => evalCond(s, q.where!, { ...ctx, it: u.uid }));
  const n = q.n ?? 1;
  switch (q.pick ?? 'all') {
    case 'all': return list;
    case 'random': return pickRandom(s, list, n);
    case 'first': return list.slice(0, n);
    case 'lowestHp': return [...list].sort((a, b) => a.hp - b.hp || a.ts - b.ts).slice(0, n);
    case 'highestHp': return [...list].sort((a, b) => b.hp - a.hp || a.ts - b.ts).slice(0, n);
    case 'highestAtk': return [...list].sort((a, b) => atkOf(s, b) - atkOf(s, a) || a.ts - b.ts).slice(0, n);
    case 'lowestAtk': return [...list].sort((a, b) => atkOf(s, a) - atkOf(s, b) || a.ts - b.ts).slice(0, n);
  }
}

export function evalCond(s: CombatState, c: Condition, ctx: Ctx): boolean {
  if ('gt' in c) return evalValue(s, c.gt[0], ctx) > evalValue(s, c.gt[1], ctx);
  if ('lt' in c) return evalValue(s, c.lt[0], ctx) < evalValue(s, c.lt[1], ctx);
  if ('gte' in c) return evalValue(s, c.gte[0], ctx) >= evalValue(s, c.gte[1], ctx);
  if ('lte' in c) return evalValue(s, c.lte[0], ctx) <= evalValue(s, c.lte[1], ctx);
  if ('eq' in c) return evalValue(s, c.eq[0], ctx) === evalValue(s, c.eq[1], ctx);
  if ('and' in c) return c.and.every((x) => evalCond(s, x, ctx));
  if ('or' in c) return c.or.some((x) => evalCond(s, x, ctx));
  if ('not' in c) return !evalCond(s, c.not, ctx);
  if ('hasStatus' in c) return select(s, c.hasStatus.of, ctx).some((u) => (u.statuses[c.hasStatus.status] ?? 0) > 0);
  if ('hasKeyword' in c) return select(s, c.hasKeyword.of, ctx).some((u) => hasKw(s, u, c.hasKeyword.keyword));
  if ('isUnit' in c) return select(s, c.isUnit, ctx).some((u) => u.kind === 'unit');
  if ('isCommander' in c) return select(s, c.isCommander, ctx).some((u) => u.kind === 'commander');
  if ('alive' in c) return select(s, c.alive, ctx).length > 0;
  if ('inRow' in c) return select(s, c.inRow.of, ctx).some((u) => u.row === c.inRow.row);
  if ('combo' in c) return s.cardsPlayedThisTurn >= c.combo;
  if ('resonance' in c) return s.sources.filter((x) => !x.temp && x.color === c.resonance.color).length >= c.resonance.n;
  if ('suit' in c) {
    const j = ctx.judge;
    if (!j) return false;
    if (c.suit === 'yang') return YANG.includes(j.suit);
    if (c.suit === 'yin') return !YANG.includes(j.suit);
    return j.suit === c.suit;
  }
  if ('rank' in c) {
    const r = ctx.judge?.rank ?? 0;
    return (c.rank.min === undefined || r >= c.rank.min) && (c.rank.max === undefined || r <= c.rank.max);
  }
  if ('chance' in c) return rand(s.rng) < c.chance;
  if ('inWindow' in c) return !!ctx.inWindow === c.inWindow;
  if ('declared' in c) {
    const actor = unit(s, ctx.declared?.actor);
    if (!actor || actor.origin !== 'enemy' || !actor.intent) return false;
    const mv = content().enemy(actor.def).moves[actor.intent.move];
    return !!mv && mv.intent.includes(c.declared);
  }
  if ('myTurn' in c) return (s.active === ctx.side) === c.myTurn;
  if ('eventCard' in c) {
    const card = ctx.event?.card;
    if (!card) return false;
    return matchCard(content().card(card.id, card.up), c.eventCard);
  }
  if ('hasEquip' in c) return !!s.sides[ctx.side].equip[c.hasEquip];
  if ('emptySlot' in c) {
    const sd = s.sides[c.emptySlot.side === 'friendly' ? ctx.side : other(ctx.side)];
    const rows = c.emptySlot.row ? [c.emptySlot.row] : (['front', 'back'] as const);
    return rows.some((r) => sd[r].some((id) => !alive(unit(s, id))));
  }
  return false;
}
