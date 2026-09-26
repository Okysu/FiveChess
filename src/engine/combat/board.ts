/** Board geometry, unit stats and continuous modifiers. */
import { content, matchCard } from '../content';
import { skillDef } from './skills';
import type { Keyword, ModStat, Modifier, StatusId } from '../defs';
import type { CombatState, Side, Unit, UnitSnap, CardInst } from './state';
import { other } from './state';
import { evalCond, evalValue } from './eval';

export const FRONT = 4;
export const BACK = 3;

export function unit(s: CombatState, uid: number | null | undefined): Unit | undefined {
  if (uid == null) return undefined;
  const u = s.units[uid];
  return u && !u.removed ? u : undefined;
}

export function alive(u: Unit | undefined): u is Unit {
  return !!u && !u.removed && !u.dead && u.hp > 0;
}

export function commanderOf(s: CombatState, side: Side): Unit | undefined {
  return unit(s, s.sides[side].commander);
}

export function unitsOf(s: CombatState, side: Side, includeCommander = false): Unit[] {
  const sd = s.sides[side];
  const out: Unit[] = [];
  if (includeCommander) {
    const c = unit(s, sd.commander);
    if (alive(c)) out.push(c);
  }
  for (const id of sd.front) { const u = unit(s, id); if (alive(u)) out.push(u); }
  for (const id of sd.back) { const u = unit(s, id); if (alive(u)) out.push(u); }
  return out;
}

/** board order used for deterministic iteration: commander → front L→R → back L→R */
export function boardOrder(s: CombatState, side: Side): Unit[] {
  return unitsOf(s, side, true);
}

export function rowNonEmpty(s: CombatState, side: Side, row: 'front' | 'back'): boolean {
  return s.sides[side][row].some((id) => alive(unit(s, id)));
}

export function emptySlots(s: CombatState, side: Side, row: 'front' | 'back'): number[] {
  const arr = s.sides[side][row];
  const out: number[] = [];
  arr.forEach((id, i) => { if (!alive(unit(s, id))) out.push(i); });
  return out;
}

export function depth(s: CombatState, u: Unit): number {
  if (u.row === 'front') return 1;
  const f = rowNonEmpty(s, u.side, 'front');
  if (u.row === 'back') return f ? 2 : 1;
  const b = rowNonEmpty(s, u.side, 'back');
  let d = 1 + (f ? 1 : 0) + (b ? 1 : 0);
  if (s.sides[u.side].equip.mount && mountKind(s, u.side) === 'defense') d += 1;
  return d;
}

function mountKind(s: CombatState, side: Side) {
  const m = s.sides[side].equip.mount;
  if (!m) return null;
  return content().card(m.card, m.up).equip?.mount ?? null;
}

export function hasKw(s: CombatState, u: Unit, k: Keyword): boolean {
  if (u.extraKeywords.includes(k)) return true;
  if (u.silenced) return false;
  const base = baseKeywords(u);
  if (base.includes(k)) return true;
  // aura / modifier-granted
  for (const m of modsFor(s, 'keyword', u)) if (m.keyword === k) return true;
  return false;
}

function baseKeywords(u: Unit): Keyword[] {
  const c = content();
  if (u.origin === 'enemy') return c.enemy(u.def).keywords ?? [];
  if (u.origin === 'card' || u.origin === 'token') return c.card(u.def, u.up).unit?.keywords ?? [];
  return [];
}

export function keywordsOf(s: CombatState, u: Unit): Keyword[] {
  const all: Keyword[] = ['taunt', 'ranged', 'leap', 'haste', 'twinStrike', 'lifesteal', 'deathtouch', 'stealth'];
  const out = all.filter((k) => hasKw(s, u, k));
  if (u.thorns > 0 && !u.silenced) out.push('thorns');
  if (u.side === 'enemy' && u.origin === 'enemy' && content().enemies.get(u.def)?.tier === 'boss') out.push('sunder');
  if (u.growth > 0 && !u.silenced) out.push('growth');
  if (u.ward > 0) out.push('ward');
  return out;
}

export function reach(s: CombatState, u: Unit): number {
  if (u.kind === 'commander') {
    if (u.side === 'enemy') return 99;
    const w = s.sides[u.side].equip.weapon;
    if (!w) return 0;
    const def = content().card(w.card, w.up).equip!;
    let r = (def.range ?? 1) + w.rangeBonus;
    if (mountKind(s, u.side) === 'offense') r += 1;
    r += sumMods(s, 'range', u.side, u);
    return r;
  }
  if (hasKw(s, u, 'ranged') || hasKw(s, u, 'leap')) return 99;
  return u.row === 'front' ? 1 : 0;
}

export function adjacentUnits(s: CombatState, u: Unit): Unit[] {
  if (u.kind === 'commander') return [];
  const sd = s.sides[u.side];
  const ids: (number | null | undefined)[] = [];
  if (u.row === 'front') {
    ids.push(sd.front[u.slot - 1], sd.front[u.slot + 1]);
    // back slot j touches front j and j+1
    ids.push(sd.back[u.slot - 1], sd.back[u.slot]);
  } else {
    ids.push(sd.back[u.slot - 1], sd.back[u.slot + 1]);
    ids.push(sd.front[u.slot], sd.front[u.slot + 1]);
  }
  const out: Unit[] = [];
  for (const id of ids) { const x = unit(s, id ?? null); if (alive(x)) out.push(x); }
  return out;
}

// ───────────── modifiers ─────────────

interface ModSrc { mod: Modifier; ownerSide: Side; owner: Unit | null }

/** collect every continuous modifier currently on the battlefield */
export function allModifiers(s: CombatState): ModSrc[] {
  const c = content();
  const out: ModSrc[] = [];
  const pc = commanderOf(s, 'player') ?? null;
  for (const r of s.relics) {
    if (r.disabled) continue;
    for (const m of c.relic(r.id).modifiers ?? []) out.push({ mod: m, ownerSide: 'player', owner: pc });
  }
  for (const sk of s.skills) {
    const def = skillDef(s, sk);
    for (const m of def?.modifiers ?? []) out.push({ mod: m, ownerSide: 'player', owner: pc });
  }
  for (const side of ['player', 'enemy'] as Side[]) {
    const sd = s.sides[side];
    const cmd = commanderOf(s, side) ?? null;
    for (const eq of Object.values(sd.equip)) {
      if (!eq) continue;
      for (const m of c.card(eq.card, eq.up).equip?.modifiers ?? []) out.push({ mod: m, ownerSide: side, owner: cmd });
    }
    if (sd.field) for (const m of c.card(sd.field.card, sd.field.up).field?.modifiers ?? []) out.push({ mod: m, ownerSide: side, owner: cmd });
    for (const u of unitsOf(s, side, true)) {
      if (u.silenced) continue;
      if (u.origin === 'enemy') {
        for (const m of c.enemy(u.def).modifiers ?? []) out.push({ mod: m, ownerSide: side, owner: u });
      } else if (u.origin === 'card' || u.origin === 'token') {
        const ud = c.card(u.def, u.up).unit;
        for (const m of ud?.modifiers ?? []) out.push({ mod: m, ownerSide: side, owner: u });
        for (const m of ud?.aura ?? []) out.push({ mod: { ...m, who: m.who ?? 'adjacent' }, ownerSide: side, owner: u });
      }
    }
  }
  return out;
}

function modApplies(s: CombatState, src: ModSrc, forSide: Side, target: Unit | null): boolean {
  const who = src.mod.who ?? 'friendly';
  switch (who) {
    case 'all': return true;
    case 'friendly': return forSide === src.ownerSide;
    case 'enemy': return forSide === other(src.ownerSide);
    case 'self': return !!target && !!src.owner && target.uid === src.owner.uid;
    case 'commander': return !!target && target.kind === 'commander' && target.side === src.ownerSide;
    case 'friendlyUnits': return !!target && target.kind === 'unit' && target.side === src.ownerSide && target.uid !== src.owner?.uid;
    case 'enemyUnits': return !!target && target.kind === 'unit' && target.side === other(src.ownerSide);
    case 'adjacent': return !!target && !!src.owner && src.owner.kind === 'unit' && adjacentUnits(s, src.owner).some((a) => a.uid === target.uid);
  }
}

export function modsFor(s: CombatState, stat: ModStat, target: Unit): Modifier[] {
  const out: Modifier[] = [];
  for (const src of allModifiers(s)) {
    if (src.mod.stat !== stat) continue;
    if (!modApplies(s, src, target.side, target)) continue;
    if (src.mod.if && !evalCond(s, src.mod.if, modCtx(src, target))) continue;
    out.push(src.mod);
  }
  return out;
}

function modCtx(src: ModSrc, target: Unit | null) {
  return { side: src.ownerSide, source: src.owner?.uid ?? null, kind: 'system' as const, target: target?.uid ?? null, vars: {} };
}

/** sum a side-level modifier (e.g. emberCap, draw) — target is the side's commander when relevant */
export function sumMods(s: CombatState, stat: ModStat, side: Side, target: Unit | null = null, card?: CardInst): number {
  let total = 0;
  const tgt = target ?? commanderOf(s, side) ?? null;
  for (const src of allModifiers(s)) {
    if (src.mod.stat !== stat) continue;
    const who = src.mod.who ?? 'friendly';
    if (tgt) { if (!modApplies(s, src, side, tgt)) continue; }
    else if (!(who === 'all' || (who === 'friendly' && side === src.ownerSide) || (who === 'enemy' && side !== src.ownerSide))) continue;
    if (card && src.mod.filter) {
      const def = content().card(card.id, card.up);
      if (!matchCard(def, src.mod.filter)) continue;
    } else if (!card && src.mod.filter) continue;
    if (src.mod.if && !evalCond(s, src.mod.if, modCtx(src, tgt))) continue;
    total += src.mod.amount === undefined ? 1 : evalValue(s, src.mod.amount, modCtx(src, tgt));
  }
  return total;
}

// ───────────── stats ─────────────

export function atkOf(s: CombatState, u: Unit): number {
  let a = u.baseAtk + u.atkBuff + u.tempAtk;
  if (u.kind === 'commander' && u.side === 'player') {
    const w = s.sides[u.side].equip.weapon;
    if (w) a += (content().card(w.card, w.up).equip?.atk ?? 0) + w.atkBonus;
  }
  for (const m of modsFor(s, 'atk', u)) a += evalValue(s, m.amount ?? 0, { side: u.side, source: u.uid, kind: 'system', target: u.uid, vars: {} });
  return Math.max(0, a);
}

export function maxHpOf(s: CombatState, u: Unit): number {
  let h = u.baseMaxHp + u.hpBuff;
  if (u.kind === 'unit') for (const m of modsFor(s, 'maxHp', u)) h += evalValue(s, m.amount ?? 0, { side: u.side, source: u.uid, kind: 'system', target: u.uid, vars: {} });
  return Math.max(1, h);
}

export function status(u: Unit, st: StatusId): number {
  return u.statuses[st] ?? 0;
}

export function snap(s: CombatState, u: Unit): UnitSnap {
  return {
    uid: u.uid, side: u.side, kind: u.kind, def: u.def, name: u.name, row: u.row, slot: u.slot,
    atk: atkOf(s, u), hp: u.hp, maxHp: maxHpOf(s, u), armor: u.armor, ward: u.ward, keywords: keywordsOf(s, u), up: u.up,
  };
}

/** can this unit attack right now (ignoring targets)? */
export function canAttack(s: CombatState, u: Unit): boolean {
  if (!alive(u)) return false;
  if (status(u, 'freeze') > 0 || status(u, 'stun') > 0) return false;
  if (atkOf(s, u) <= 0) return false;
  const maxAttacks = hasKw(s, u, 'twinStrike') ? 2 : 1;
  if (u.attacks >= maxAttacks) return false;
  if (u.kind === 'unit' && u.enteredTurn === s.turn && u.side === s.active && !hasKw(s, u, 'haste')) return false;
  if (reach(s, u) <= 0) return false;
  return true;
}

/** legal targets for an attack by u (respecting depth, reach, taunt, stealth) */
export function attackTargets(s: CombatState, u: Unit, ignoreReach = false): Unit[] {
  const foes = unitsOf(s, other(u.side), true).filter((f) => !f.stealth);
  const r = ignoreReach ? 99 : reach(s, u);
  const inReach = foes.filter((f) => depth(s, f) <= r);
  if (hasKw(s, u, 'leap')) return foes;
  const taunts = inReach.filter((f) => f.kind === 'unit' && hasKw(s, f, 'taunt'));
  return taunts.length ? taunts : inReach;
}
