/**
 * Combat rules engine: task stack, effect interpreter, triggers, state checks, turn flow, chains.
 * Pure TypeScript, no rendering dependencies. All randomness flows through s.rng.
 */
import { content, matchCard } from '../content';
import type { CardFilter, Color, Effect, JudgeBranches, StatusId, Trigger, TriggerOn, Suit, CardDef, EnemyMove, IntentType } from '../defs';
import { YANG } from '../defs';
import { randInt, shuffle, sample, pick } from '../rng';
import type {
  AnyEffect, CardInst, ChainLink, CombatState, Ctx, CEvent, FateCard, PendingTrigger, Side, Task, Unit, InternalEffect,
} from './state';
import { other } from './state';
import { combatTune } from './tuning';
import {
  alive, atkOf, attackTargets, boardOrder, commanderOf, emptySlots, hasKw, maxHpOf, snap, sumMods, unit, unitsOf, BACK, FRONT, depth,
} from './board';
import { evalCond, evalValue, select } from './eval';
import { skillDef } from './skills';
import { enemyMoves, rollIntent, retarget } from './intents';

// ═════════════ utilities ═════════════

export function emit(s: CombatState, e: CEvent) {
  s.events.push(e);
}

export function newUid(s: CombatState) { return s.nextUid++; }
export function newTs(s: CombatState) { return s.nextTs++; }

export function cardDef(c: CardInst): CardDef { return content().card(c.id, c.up); }

export function baseCtx(s: CombatState, side: Side, kind: Ctx['kind'], extra: Partial<Ctx> = {}): Ctx {
  return { side, source: s.sides[side].commander, kind, target: null, vars: {}, ...extra };
}

function cardCtx(s: CombatState, side: Side, card: CardInst, target: number | null, x = 0): Ctx {
  const def = cardDef(card);
  return { side, source: s.sides[side].commander, kind: 'card', card, defId: card.id, up: card.up, target, vars: { ...(def.vars ?? {}) }, x };
}

export function pushFx(s: CombatState, effects: AnyEffect[], ctx: Ctx) {
  if (!effects.length) return;
  s.tasks.push({ k: 'fx', effects: [...effects], i: 0, ctx });
}

function spliceNext(task: Extract<Task, { k: 'fx' }>, effs: AnyEffect[]) {
  task.effects.splice(task.i, 0, ...effs);
}

// ═════════════ triggers ═════════════

interface FireInfo {
  subject?: number | null;
  side?: Side;
  source?: number | null;
  target?: number | null;
  amount?: number;
  card?: CardInst;
  suit?: Suit;
  status?: StatusId;
  judge?: FateCard;
  /** cardDiscarded from the end-of-turn hand clear */
  endOfTurn?: boolean;
}

const SELF_DEFAULT: TriggerOn[] = ['damaged', 'attacked', 'death', 'enter', 'dealtDamage', 'attacking', 'healed', 'armorGained', 'armorBroken', 'statusApplied'];
const ANY_DEFAULT: TriggerOn[] = ['judged', 'combatStart', 'combatEnd', 'rejudged'];
const ENEMY_DEFAULT: TriggerOn[] = ['opponentTurnStart', 'opponentTurnEnd', 'actionDeclared'];

function defaultWho(on: TriggerOn): NonNullable<Trigger['who']> {
  if (SELF_DEFAULT.includes(on)) return 'self';
  if (ANY_DEFAULT.includes(on)) return 'any';
  if (ENEMY_DEFAULT.includes(on)) return 'enemy';
  return 'friendly';
}

export function fire(s: CombatState, on: TriggerOn, info: FireInfo) {
  const c = content();
  const found: PendingTrigger[] = [];
  const consider = (trigs: Trigger[] | undefined, ownerSide: Side, selfUid: number | null, ts: number, base: Ctx, label: string) => {
    if (!trigs) return;
    trigs.forEach((t, idx) => {
      // opponent turn triggers are derived from turn events
      let evOn: TriggerOn = t.on;
      if (t.on === 'opponentTurnStart') evOn = 'turnStart';
      if (t.on === 'opponentTurnEnd') evOn = 'turnEnd';
      if (evOn !== on) return;
      const who = t.who ?? defaultWho(t.on);
      const evSide = info.side;
      if (who === 'self' && (info.subject == null || info.subject !== selfUid)) return;
      if (who === 'friendly' && evSide !== ownerSide) return;
      if (who === 'enemy' && evSide !== other(ownerSide)) return;
      if (t.suit && info.suit) {
        if (t.suit === 'yang' && !YANG.includes(info.suit)) return;
        if (t.suit === 'yin' && YANG.includes(info.suit)) return;
        if (t.suit !== 'yang' && t.suit !== 'yin' && t.suit !== info.suit) return;
      } else if (t.suit && !info.suit) return;
      // 弃置 means a card effect or skill; the end-of-turn hand clear only counts where a trigger says so
      if (info.endOfTurn && !t.endOfTurn) return;
      if (t.status && t.status !== info.status) return;
      const key = `${t.limit === 'combat' ? 'combat:' : ''}${label}#${idx}`;
      if (t.limit && (s.triggerUse[key] ?? 0) >= 1) return;
      const ctx: Ctx = {
        ...base,
        vars: { ...base.vars },
        event: { source: info.source ?? null, target: info.target ?? info.subject ?? null, amount: info.amount ?? 0, card: info.card, suit: info.suit, status: info.status },
        judge: info.judge ?? base.judge,
      };
      if (t.if && !evalCond(s, t.if, ctx)) return;
      if (t.limit) s.triggerUse[key] = (s.triggerUse[key] ?? 0) + 1;
      found.push({ effects: t.effects, ctx, side: ownerSide, ts, label: key });
      // presentation: the relic / passive skill that just triggered lights up (e.g. 绛书 焚卷 on each 弃置)
      if (ctx.owner?.kind === 'relic') emit(s, { t: 'relic', id: String(ctx.owner.ref) });
      else if (ctx.owner?.kind === 'skill') emit(s, { t: 'passive', index: Number(ctx.owner.ref) });
    });
  };

  const pc = commanderOf(s, 'player');
  const pcu = pc?.uid ?? null;
  // relics
  s.relics.forEach((r, i) => {
    if (r.disabled) return;
    consider(c.relic(r.id).triggers, 'player', pcu, 1 + i * 0.001, { ...baseCtx(s, 'player', 'relic'), owner: { kind: 'relic', ref: r.id } }, `relic:${r.id}`);
  });
  // commander & lieutenant skills
  s.skills.forEach((sk, i) => {
    const def = skillDef(s, sk);
    if (!def) return;
    consider(def.triggers, 'player', pcu, 0.5 + i * 0.001, { ...baseCtx(s, 'player', 'skill'), owner: { kind: 'skill', ref: i } }, `skill:${i}:${sk.awakened ? 1 : 0}`);
    if (!sk.awakened && def.awaken && def.awaken.on === on) {
      const aw = def.awaken;
      consider([{ on: aw.on, who: aw.who, if: aw.if, effects: [{ op: 'script', id: '__awaken', args: { skill: i } }], limit: 'combat' }], 'player', pcu, 0.5, baseCtx(s, 'player', 'skill'), `awaken:${i}`);
    }
  });
  for (const side of [s.active, other(s.active)] as Side[]) {
    const sd = s.sides[side];
    const cmd = sd.commander;
    for (const slot of ['weapon', 'armor', 'mount', 'treasure'] as const) {
      const eq = sd.equip[slot];
      if (!eq) continue;
      const def = c.card(eq.card, eq.up);
      consider(def.equip?.triggers, side, cmd, eq.ts, { ...baseCtx(s, side, 'equip'), vars: { ...(def.vars ?? {}) } }, `equip:${eq.uid}`);
    }
    if (sd.field) {
      const def = c.card(sd.field.card, sd.field.up);
      consider(def.field?.triggers, side, cmd, sd.field.ts, { ...baseCtx(s, side, 'field'), vars: { ...(def.vars ?? {}) } }, `field:${sd.field.uid}`);
    }
    // units (incl. enemy commanders); dying units only for their own death
    const ids = [cmd, ...sd.front, ...sd.back];
    for (const id of ids) {
      const u = unit(s, id);
      if (!u || u.removed) continue;
      if (u.dead && !(on === 'death' && info.subject === u.uid)) continue;
      if (!u.dead && u.hp <= 0 && on !== 'death') continue;
      if (u.silenced) continue;
      const trigs = unitTriggers(u);
      const vars = unitVars(u);
      consider(trigs, side, u.uid, u.ts, { side, source: u.uid, kind: 'unit', target: null, vars, owner: { kind: 'unit', ref: u.uid } }, `unit:${u.uid}`);
    }
  }
  // cards in hand
  for (const card of s.hand) {
    const def = cardDef(card);
    if (def.inHand) consider(def.inHand, 'player', pcu, 1000 + card.uid, { ...cardCtx(s, 'player', card, null), card }, `hand:${card.uid}`);
  }
  found.sort((a, b) => (a.side === s.active ? 0 : 1) - (b.side === s.active ? 0 : 1) || a.ts - b.ts);
  s.triggers.push(...found);
}

function unitTriggers(u: Unit): Trigger[] | undefined {
  const c = content();
  if (u.origin === 'enemy') {
    const e = c.enemy(u.def);
    return e.passives;
  }
  if (u.origin === 'card' || u.origin === 'token') return c.card(u.def, u.up).unit?.triggers;
  return undefined;
}

function unitVars(u: Unit): Record<string, number> {
  if (u.origin === 'card' || u.origin === 'token') return { ...(content().card(u.def, u.up).vars ?? {}) };
  return {};
}

// ═════════════ damage / healing / statuses ═════════════

export type DmgKind = 'attack' | 'effect' | 'burn' | 'poison' | 'thorns' | 'retaliate' | 'loss';

const isAttackKind = (k: DmgKind, attackFlag: boolean) => k === 'attack' || k === 'retaliate' || (k === 'effect' && attackFlag);

/** pure damage calculation (for previews and resolution) */
export function calcDamage(s: CombatState, src: Unit | undefined, tgt: Unit, base: number, kind: DmgKind, attackFlag = false): number {
  let amt = base;
  if (kind === 'loss') return Math.max(0, Math.floor(amt));
  const srcSide = src?.side;
  if (isAttackKind(kind, attackFlag) && src) {
    amt += src.statuses.might ?? 0;
    amt += sumMods(s, 'attackDamage', src.side, src);
    if ((src.statuses.weak ?? 0) > 0) amt *= 0.75;
  } else if (kind === 'effect' && srcSide) {
    amt += sumMods(s, 'effectDamage', srcSide, src ?? null);
  } else if (kind === 'burn') {
    amt += sumMods(s, 'burnDamage', tgt.side, tgt);
  } else if (kind === 'poison') {
    amt += sumMods(s, 'poisonDamage', tgt.side, tgt);
  }
  // difficulty curve (tuning.ts): enemy attacks and damage effects
  if (src && src.side === 'enemy' && src.origin === 'enemy' && (isAttackKind(kind, attackFlag) || kind === 'effect')) {
    // 逆命 8: normal enemies' intent values +1 — added before the curve multiplier so the step stays proportional
    // in every act (added after it, +1 was +20–40% on the scaled-down act 2–3 hits)
    if (s.cfg.ascension >= 8 && content().enemies.get(src.def)?.tier === 'normal') amt += 1;
    amt *= combatTune(s).dmg;
  }
  amt += sumMods(s, 'damageTaken', tgt.side, tgt);
  if ((tgt.statuses.vulnerable ?? 0) > 0) amt *= 1.5;
  if (src && hasKw(s, src, 'deathtouch') && tgt.kind === 'commander' && (kind === 'attack' || kind === 'effect')) amt += 3;
  return Math.max(0, Math.floor(amt));
}

/** a boss-tier enemy (not its summoned minions) */
function isBossEnemy(u: Unit): boolean {
  return u.side === 'enemy' && u.origin === 'enemy' && content().enemies.get(u.def)?.tier === 'boss';
}

export function dealDamage(s: CombatState, srcUid: number | null, tgtUid: number, base: number, kind: DmgKind, opts: { attack?: boolean; pierce?: boolean } = {}): number {
  const tgt = unit(s, tgtUid);
  if (!alive(tgt)) return 0;
  const src = unit(s, srcUid) ?? undefined;
  const amount = calcDamage(s, src, tgt, base, kind, !!opts.attack);
  const ignoresDefense = kind === 'poison' || kind === 'loss' || !!opts.pierce;
  if (amount > 0 && tgt.ward > 0 && !ignoresDefense) {
    tgt.ward -= 1;
    emit(s, { t: 'damage', target: tgt.uid, source: srcUid, amount, hpLoss: 0, armorLoss: 0, warded: true, hp: tgt.hp, armor: tgt.armor, kind: toEvKind(kind) });
    emit(s, { t: 'ward', target: tgt.uid, ward: tgt.ward });
    if (src && src.stealth) src.stealth = false;
    return 0;
  }
  let rest = amount;
  let armorLoss = 0;
  if (!ignoresDefense && tgt.armor > 0) {
    // 破甲: a boss's attacks strip 2 armor per point of damage (armor soaks them at half value)
    const breaks = src && isAttackKind(kind, !!opts.attack) && isBossEnemy(src) ? 2 : 1;
    armorLoss = Math.min(tgt.armor, rest * breaks);
    tgt.armor -= armorLoss;
    rest -= Math.ceil(armorLoss / breaks);
  }
  const hpLoss = Math.min(rest, Math.max(0, tgt.hp));
  tgt.hp -= rest;
  if (tgt.hp < 0) tgt.hp = 0;
  emit(s, { t: 'damage', target: tgt.uid, source: srcUid, amount, hpLoss, armorLoss, warded: false, hp: tgt.hp, armor: tgt.armor, kind: toEvKind(kind) });
  if (tgt.side === 'player' && tgt.kind === 'commander') s.stats.damageTaken += hpLoss;
  if (tgt.side === 'enemy') s.stats.damageDealt += hpLoss;
  if (armorLoss > 0 && tgt.armor === 0) fire(s, 'armorBroken', { subject: tgt.uid, side: tgt.side, source: srcUid });
  if (amount > 0) {
    fire(s, 'damaged', { subject: tgt.uid, side: tgt.side, source: srcUid, amount: hpLoss + armorLoss });
    if (src) fire(s, 'dealtDamage', { subject: src.uid, side: src.side, source: src.uid, target: tgt.uid, amount: hpLoss + armorLoss });
  }
  if (src && src.stealth) src.stealth = false;
  if (src && (hpLoss + armorLoss) > 0 && hasKw(s, src, 'lifesteal') && kind !== 'burn' && kind !== 'poison') {
    const cmd = commanderOf(s, src.side);
    if (cmd) heal(s, cmd.uid, hpLoss + armorLoss, src.uid);
  }
  if (src && hpLoss > 0 && tgt.kind === 'unit' && hasKw(s, src, 'deathtouch') && (kind === 'attack' || kind === 'effect' || kind === 'retaliate')) {
    tgt.hp = 0;
  }
  checkPhase(s, tgt);
  return hpLoss;
}

function toEvKind(k: DmgKind) { return k; }

function checkPhase(s: CombatState, u: Unit) {
  if (u.origin !== 'enemy' || u.hp <= 0) return;
  const phases = content().enemy(u.def).phases;
  if (!phases) return;
  const cur = u.pendingPhase ?? u.phase ?? 0;
  for (let i = cur; i < phases.length; i++) {
    const ph = phases[i]!;
    if (ph.minAscension !== undefined && s.cfg.ascension < ph.minAscension) break;
    if (u.hp <= Math.floor(maxHpOf(s, u) * ph.hpBelow)) u.pendingPhase = i + 1;
  }
}

export function heal(s: CombatState, tgtUid: number, base: number, srcUid: number | null = null): number {
  const t = unit(s, tgtUid);
  if (!alive(t)) return 0;
  const amt = Math.max(0, base + sumMods(s, 'healing', t.side, t));
  const before = t.hp;
  t.hp = Math.min(maxHpOf(s, t), t.hp + amt);
  const gained = t.hp - before;
  emit(s, { t: 'heal', target: t.uid, amount: gained, hp: t.hp });
  if (gained > 0) fire(s, 'healed', { subject: t.uid, side: t.side, source: srcUid, amount: gained });
  return gained;
}

export function gainArmor(s: CombatState, tgtUid: number, base: number, srcUid: number | null = null) {
  const t = unit(s, tgtUid);
  if (!alive(t)) return;
  const amt = Math.max(0, base + (t.statuses.tenacity ?? 0) + sumMods(s, 'armorGain', t.side, t));
  if (amt <= 0) return;
  t.armor += amt;
  emit(s, { t: 'armor', target: t.uid, amount: amt, armor: t.armor });
  fire(s, 'armorGained', { subject: t.uid, side: t.side, source: srcUid, amount: amt });
}

const DEBUFFS: StatusId[] = ['burn', 'poison', 'freeze', 'stun', 'vulnerable', 'weak', 'silence'];
const BUFFS: StatusId[] = ['might', 'tenacity', 'regen'];

export function applyStatus(s: CombatState, tgtUid: number, st: StatusId, amount: number, srcUid: number | null = null) {
  const t = unit(s, tgtUid);
  if (!alive(t) || amount === 0) return;
  if (st === 'silence') { silence(s, t); return; }
  if (st === 'stun') {
    if (t.stunImmune > 0 || (t.statuses.stun ?? 0) > 0) return;
    amount = 1;
  }
  // difficulty curve (tuning.ts) also covers the damage-over-time enemies put on the player's side
  if ((st === 'burn' || st === 'poison') && amount > 0 && t.side === 'player') {
    const src = unit(s, srcUid);
    if (src && src.side === 'enemy' && src.origin === 'enemy') amount = Math.max(1, Math.round(amount * combatTune(s).dmg));
  }
  const before = t.statuses[st] ?? 0;
  let total = before + amount;
  if (st !== 'might' && total < 0) total = 0;
  if (total === 0) delete t.statuses[st];
  else t.statuses[st] = total;
  // applied mid-turn to the acting side → it should still cover that side's next turn, so skip this turn's countdown.
  // Applied at the start of the bearer's own turn (before it acted) it counts this turn: freeze 1 = one turn.
  if (amount > 0 && s.active === t.side && s.acted && (st === 'freeze' || st === 'vulnerable' || st === 'weak')) (t.fresh ??= {})[st] = true;
  emit(s, { t: 'status', target: t.uid, status: st, delta: total - before, total });
  if (amount > 0) fire(s, 'statusApplied', { subject: t.uid, side: t.side, source: srcUid, amount, status: st });
}

function silence(s: CombatState, u: Unit) {
  u.silenced = true;
  u.extraKeywords = [];
  u.thorns = 0;
  u.growth = 0;
  u.stealth = false;
  emit(s, { t: 'status', target: u.uid, status: 'silence', delta: 1, total: 1 });
  emit(s, { t: 'stats', target: u.uid, atk: atkOf(s, u), hp: u.hp, maxHp: maxHpOf(s, u) });
}

// ═════════════ attacks ═════════════

export function isRangedAttacker(s: CombatState, a: Unit): boolean {
  if (a.kind === 'commander') {
    if (a.side === 'enemy') return true;
    const w = s.sides[a.side].equip.weapon;
    return !!w && (content().card(w.card, w.up).equip?.range ?? 1) + w.rangeBonus >= 2;
  }
  return hasKw(s, a, 'ranged');
}

export function performAttack(s: CombatState, attackerUid: number, targetUid: number, amountOverride?: number, times = 1, consume = true) {
  const a = unit(s, attackerUid);
  const t = unit(s, targetUid);
  if (!alive(a) || !alive(t)) return;
  emit(s, { t: 'attack', attacker: a.uid, target: t.uid });
  fire(s, 'attacking', { subject: a.uid, side: a.side, target: t.uid, source: a.uid });
  fire(s, 'attacked', { subject: t.uid, side: t.side, source: a.uid });
  const ranged = isRangedAttacker(s, a);
  for (let i = 0; i < times; i++) {
    if (!alive(a) || !alive(t) || a.hp <= 0 || t.hp <= 0) break;
    const dmg = amountOverride ?? atkOf(s, a);
    const tAtk = atkOf(s, t);
    dealDamage(s, a.uid, t.uid, dmg, 'attack');
    if (!ranged && t.kind === 'unit' && tAtk > 0) dealDamage(s, t.uid, a.uid, tAtk, 'retaliate');
    if (!ranged && t.thorns > 0 && !t.silenced) dealDamage(s, t.uid, a.uid, t.thorns, 'thorns');
  }
  if (consume) a.attacks += 1;
  a.stealth = false;
  // weapon wear
  if (a.kind === 'commander') {
    const w = s.sides[a.side].equip.weapon;
    if (w && w.durability > 0) {
      w.durability -= 1;
      if (w.durability <= 0) destroyEquip(s, a.side, 'weapon');
      else emitWeapon(s, a.side);
    }
  }
}

export function emitWeapon(s: CombatState, side: Side) {
  const w = s.sides[side].equip.weapon;
  if (!w) return;
  const def = content().card(w.card, w.up).equip!;
  emit(s, { t: 'weapon', side, atk: (def.atk ?? 0) + w.atkBonus, range: (def.range ?? 1) + w.rangeBonus, durability: w.durability });
}

export function destroyEquip(s: CombatState, side: Side, slot: 'weapon' | 'armor' | 'mount' | 'treasure') {
  const eq = s.sides[side].equip[slot];
  if (!eq) return;
  delete s.sides[side].equip[slot];
  emit(s, { t: 'equip', side, slot, card: null });
  if (side === 'player') s.discard.push({ uid: eq.uid, id: eq.card, up: eq.up });
}

// ═════════════ units on board ═════════════

export function placeUnit(
  s: CombatState, side: Side, row: 'front' | 'back', slot: number,
  init: { def: string; origin: Unit['origin']; up?: boolean; card?: CardInst; atk?: number; hp?: number },
): Unit {
  const c = content();
  let atk = 0, hp = 1, name = init.def, thorns = 0, growth = 0, ward = 0;
  if (init.origin === 'enemy') {
    const e = c.enemy(init.def);
    atk = e.atk; hp = randInt(s.rng, e.hp[0], e.hp[1]); name = e.name; thorns = e.thorns ?? 0; ward = e.ward ?? 0;
    hp = scaleEnemyHp(s, e.tier, hp);
  } else {
    const d = c.card(init.def, init.up ?? false);
    atk = d.unit?.atk ?? 0; hp = d.unit?.hp ?? 1; name = d.name; thorns = d.unit?.thorns ?? 0; growth = d.unit?.growth ?? 0; ward = d.unit?.ward ?? 0;
    if ((d.unit?.keywords ?? []).includes('ward') && ward === 0) ward = 1;
  }
  if (init.atk !== undefined) atk = init.atk;
  if (init.hp !== undefined) hp = init.hp;
  const u: Unit = {
    uid: newUid(s), side, kind: 'unit', def: init.def, origin: init.origin, up: init.up ?? false, card: init.card, name, row, slot,
    baseAtk: atk, baseMaxHp: hp, hp, armor: 0, atkBuff: 0, hpBuff: 0, tempAtk: 0, ward, thorns, growth, statuses: {},
    extraKeywords: [], silenced: false, stealth: false, ts: newTs(s), enteredTurn: s.turn, attacks: 0, stunImmune: 0, delays: [], counter: 0,
  };
  if (init.origin === 'enemy') {
    u.ai = { history: [], fired: [], cycle: 0 };
    u.phase = 0;
    if (s.cfg.ascension >= 14) u.ward += 1;
  }
  s.units[u.uid] = u;
  s.sides[side][row][slot] = u.uid;
  if (hasKw(s, u, 'stealth')) u.stealth = true;
  emit(s, { t: 'summon', unit: snap(s, u), fromCard: init.origin === 'card' });
  fire(s, 'enter', { subject: u.uid, side });
  fire(s, 'unitSummoned', { subject: u.uid, side });
  if (side === 'enemy') rollIntent(s, u);
  return u;
}

export function scaleEnemyHp(s: CombatState, tier: string, hp: number) {
  const a = s.cfg.ascension;
  let m = combatTune(s).hp;
  if (tier === 'normal' && a >= 2) m += 0.1;
  if (tier === 'boss' && a >= 4) m += 0.1;
  if (tier === 'elite' && a >= 3) m += 0.1;
  return Math.round(hp * m);
}

export function autoSlot(s: CombatState, side: Side, prefer: 'front' | 'back'): { row: 'front' | 'back'; slot: number } | null {
  const first = emptySlots(s, side, prefer);
  if (first.length) return { row: prefer, slot: middleFirst(first, prefer === 'front' ? FRONT : BACK) };
  const alt: 'front' | 'back' = prefer === 'front' ? 'back' : 'front';
  const second = emptySlots(s, side, alt);
  if (second.length) return { row: alt, slot: middleFirst(second, alt === 'front' ? FRONT : BACK) };
  return null;
}

function middleFirst(slots: number[], size: number) {
  const mid = (size - 1) / 2;
  return [...slots].sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b)[0]!;
}

function removeFromBoard(s: CombatState, u: Unit) {
  const sd = s.sides[u.side];
  if (u.row === 'front' && sd.front[u.slot] === u.uid) sd.front[u.slot] = null;
  if (u.row === 'back' && sd.back[u.slot] === u.uid) sd.back[u.slot] = null;
  u.removed = true;
}

// ═════════════ state-based checks ═════════════

export function checkState(s: CombatState) {
  for (let guard = 0; guard < 50; guard++) {
    const dying: Unit[] = [];
    for (const side of [s.active, other(s.active)] as Side[]) {
      for (const u of boardOrderRaw(s, side)) if (!u.dead && !u.removed && u.hp <= 0) dying.push(u);
    }
    if (!dying.length) break;
    const pc = commanderOf(s, 'player');
    if (pc && pc.hp <= 0) {
      s.over = 'lose';
      s.phase = 'over';
      emit(s, { t: 'end', result: 'lose' });
      return;
    }
    for (const u of dying) u.dead = true;
    for (const u of dying) {
      emit(s, { t: 'death', uid: u.uid });
      if (u.side === 'enemy') s.stats.dead++;
      fire(s, 'death', { subject: u.uid, side: u.side });
      fire(s, 'unitDied', { subject: u.uid, side: u.side });
    }
    for (const u of dying) {
      removeFromBoard(s, u);
      // player unit cards return to the discard pile (tokens vanish)
      if (u.side === 'player' && u.origin === 'card' && u.card) s.discard.push({ uid: u.card.uid, id: u.card.id, up: u.card.up });
      // delays on dead units belong to nobody
      u.delays = [];
    }
  }
  // boss phase transitions
  for (const u of boardOrder(s, 'enemy')) {
    if (u.pendingPhase && u.pendingPhase > (u.phase ?? 0)) enterPhase(s, u, u.pendingPhase);
  }
}

function boardOrderRaw(s: CombatState, side: Side): Unit[] {
  const sd = s.sides[side];
  const out: Unit[] = [];
  for (const id of [sd.commander, ...sd.front, ...sd.back]) { const u = unit(s, id); if (u && !u.removed) out.push(u); }
  return out;
}

function enterPhase(s: CombatState, u: Unit, phase: number) {
  const ph = content().enemy(u.def).phases![phase - 1]!;
  u.phase = phase;
  u.pendingPhase = undefined;
  for (const st of DEBUFFS) if (u.statuses[st]) { delete u.statuses[st]; emit(s, { t: 'status', target: u.uid, status: st, delta: 0, total: 0 }); }
  if (ph.atk !== undefined) u.baseAtk = ph.atk;
  u.ai = { history: [], fired: [], cycle: 0 };
  emit(s, { t: 'phaseChange', uid: u.uid, phase, name: ph.name, text: ph.text });
  if (ph.effects) pushFx(s, ph.effects, { side: 'enemy', source: u.uid, kind: 'unit', target: null, vars: {} });
  rollIntent(s, u);
}

/** true when the combat should end with a win */
function enemyDefeated(s: CombatState): boolean {
  const sd = s.sides.enemy;
  if (sd.commander != null) {
    const b = unit(s, sd.commander);
    return !alive(b);
  }
  return unitsOf(s, 'enemy').length === 0;
}

// ═════════════ deck helpers ═════════════

export function handLimit(s: CombatState) { return 10 + sumMods(s, 'handLimit', 'player'); }

export function drawCards(s: CombatState, n: number) {
  for (let i = 0; i < n; i++) {
    if (s.hand.length >= handLimit(s)) { emit(s, { t: 'drawFail', reason: 'handFull' }); return; }
    if (!s.draw.length) {
      if (!s.discard.length) { emit(s, { t: 'drawFail', reason: 'empty' }); return; }
      s.draw = shuffle(s.rng, s.discard.splice(0));
      emit(s, { t: 'shuffle', n: s.draw.length });
      fire(s, 'shuffled', { side: 'player' });
    }
    const card = s.draw.pop()!;
    s.hand.push(card);
    emit(s, { t: 'draw', card });
    fire(s, 'cardDrawn', { side: 'player', card });
  }
}

function discardCard(s: CombatState, card: CardInst, atTurnEnd = false) {
  const i = s.hand.findIndex((c) => c.uid === card.uid);
  if (i < 0) return;
  s.hand.splice(i, 1);
  if (card.fleeting) { s.exhaust.push(card); emit(s, { t: 'exhaust', card }); fire(s, 'cardExhausted', { side: 'player', card }); return; }
  s.discard.push(card);
  emit(s, { t: 'discard', card });
  fire(s, 'cardDiscarded', { side: 'player', card, endOfTurn: atTurnEnd });
}

function exhaustCard(s: CombatState, card: CardInst) {
  const i = s.hand.findIndex((c) => c.uid === card.uid);
  if (i >= 0) s.hand.splice(i, 1);
  s.exhaust.push(card);
  emit(s, { t: 'exhaust', card });
  fire(s, 'cardExhausted', { side: 'player', card });
}

export function createCard(s: CombatState, id: string, to: 'hand' | 'draw' | 'discard', up = false, fleeting = false): CardInst {
  const card: CardInst = { uid: newUid(s), id, up, fleeting: fleeting || undefined };
  let dest = to;
  if (dest === 'hand' && s.hand.length >= handLimit(s)) dest = 'discard';
  if (dest === 'hand') s.hand.push(card);
  else if (dest === 'draw') s.draw.splice(randInt(s.rng, 0, s.draw.length), 0, card);
  else s.discard.push(card);
  emit(s, { t: 'create', card, to: dest });
  fire(s, 'cardCreated', { side: 'player', card });
  return card;
}

function ownColors(s: CombatState): Color[] {
  const c = content();
  const out: Color[] = [c.commander(s.cfg.commander).faction];
  if (s.cfg.lieutenant) { const l = c.lieutenants.get(s.cfg.lieutenant); if (l) out.push(l.faction); }
  return out;
}

// ═════════════ fate ═════════════

export function flipFate(s: CombatState): FateCard {
  if (!s.fate.deck.length) {
    s.fate.deck = shuffle(s.rng, s.fate.discard.splice(0));
    s.fate.known = 0;
    emit(s, { t: 'fate', action: 'shuffle', n: s.fate.deck.length });
  }
  const card = s.fate.deck.pop();
  if (!card) return { suit: 'moon', rank: 7, id: -1 };
  if (s.fate.known > 0) s.fate.known -= 1;
  return card;
}

/** top of deck = end of array */
export function fateTop(s: CombatState, n: number): FateCard[] {
  return s.fate.deck.slice(-n).reverse();
}

function signCap(s: CombatState) { return 2 + sumMods(s, 'signCap', 'player'); }

// ═════════════ sources / costs ═════════════

export interface CostNeed { g: number; c: Color[]; x: boolean }

export function effectiveCost(s: CombatState, card: CardInst): CostNeed {
  const def = cardDef(card);
  if (card.free) return { g: 0, c: [], x: def.cost.g === 'X' };
  const x = def.cost.g === 'X';
  let g = x ? 0 : (def.cost.g as number);
  g += card.costMod ?? 0;
  g += s.nextCardCostMod;
  g += sumMods(s, 'cost', 'player', null, card);
  return { g: Math.max(0, g), c: [...(def.cost.c ?? [])], x };
}

/** deterministic payment plan: indices into s.sources, or null if unpayable */
export function planPayment(s: CombatState, need: CostNeed, exclude?: CardInst): number[] | null {
  const avail = s.sources.map((src, i) => ({ src, i })).filter((x) => x.src.ready);
  const used = new Set<number>();
  const pref = (a: { src: { temp?: boolean; color: Color } }, b: { src: { temp?: boolean; color: Color } }) => (a.src.temp ? 0 : 1) - (b.src.temp ? 0 : 1);
  for (const col of need.c) {
    const cand = avail.filter((x) => !used.has(x.i) && x.src.color === col).sort(pref)[0];
    if (!cand) return null;
    used.add(cand.i);
  }
  // demand of each color in the rest of the hand
  const demand: Partial<Record<Color, number>> = {};
  for (const h of s.hand) {
    if (exclude && h.uid === exclude.uid) continue;
    for (const col of cardDef(h).cost.c ?? []) demand[col] = (demand[col] ?? 0) + 1;
  }
  const rest = avail.filter((x) => !used.has(x.i)).sort((a, b) => {
    const ta = a.src.temp ? 0 : 1, tb = b.src.temp ? 0 : 1;
    if (ta !== tb) return ta - tb;
    const na = a.src.color === 'N' ? 0 : 1, nb = b.src.color === 'N' ? 0 : 1;
    if (na !== nb) return na - nb;
    return (demand[a.src.color] ?? 0) - (demand[b.src.color] ?? 0) || a.i - b.i;
  });
  const g = need.x ? rest.length : need.g;
  if (rest.length < g) return null;
  for (let k = 0; k < g; k++) used.add(rest[k]!.i);
  return [...used];
}

function paySources(s: CombatState, idx: number[]) {
  for (const i of idx) { const src = s.sources[i]; if (src) src.ready = false; }
  s.sources = s.sources.filter((src) => !(src.temp && !src.ready));
  emit(s, { t: 'sources', sources: s.sources.map((x) => ({ ...x })) });
}

export function maxSources(s: CombatState) { return 10 + sumMods(s, 'maxSources', 'player'); }

export function addSource(s: CombatState, color: Color, ready: boolean): boolean {
  if (s.sources.filter((x) => !x.temp).length >= maxSources(s)) return false;
  s.sources.push({ color, ready });
  emit(s, { t: 'sources', sources: s.sources.map((x) => ({ ...x })) });
  fire(s, 'sourceGained', { side: 'player' });
  return true;
}

export function emberCap(s: CombatState) {
  return Math.max(0, s.emberCap + sumMods(s, 'emberCap', 'player'));
}

// ═════════════ target legality ═════════════

export function cardTargets(s: CombatState, side: Side, def: CardDef): number[] | null {
  let spec = def.target ?? 'none';
  if (def.type === 'delay') spec = def.delay?.on === 'friendly' ? 'friendly' : def.delay?.on === 'any' ? 'any' : 'enemy';
  if (spec === 'none') return null;
  const foe = other(side);
  const vis = (u: Unit) => !(u.stealth && u.side !== side);
  switch (spec) {
    case 'enemy': return unitsOf(s, foe, true).filter(vis).map((u) => u.uid);
    case 'enemyUnit': case 'enemyNoCommander': return unitsOf(s, foe).filter(vis).map((u) => u.uid);
    case 'friendlyUnit': return unitsOf(s, side).map((u) => u.uid);
    case 'friendly': return unitsOf(s, side, true).map((u) => u.uid);
    case 'anyUnit': return [...unitsOf(s, side), ...unitsOf(s, foe).filter(vis)].map((u) => u.uid);
    case 'any': return [...unitsOf(s, side, true), ...unitsOf(s, foe, true).filter(vis)].map((u) => u.uid);
  }
}

// ═════════════ effect interpreter ═════════════

type FxTask = Extract<Task, { k: 'fx' }>;

function setPending(s: CombatState, task: FxTask, d: NonNullable<CombatState['pending']>, eff: AnyEffect | null, data?: unknown) {
  s.pending = d;
  s.pendingCtx = { task: s.tasks.indexOf(task), effect: eff, data };
}

function execEffect(s: CombatState, task: FxTask, eff: AnyEffect) {
  const ctx = task.ctx;
  const V = (v: Parameters<typeof evalValue>[1]) => evalValue(s, v, ctx);
  const src = ctx.source;
  if (ctx.side === 'enemy' && enemyResourceOp(s, eff, V)) return;
  switch (eff.op) {
    case 'damage': {
      const times = eff.times === undefined ? 1 : V(eff.times);
      let total = 0;
      for (let k = 0; k < times; k++) {
        const tgts = select(s, eff.target, ctx);
        // an enemy move's attack damage is an attack: "when attacked / when attacking" triggers must see it
        const a = unit(s, src);
        if (k === 0 && eff.attack && ctx.kind === 'move' && alive(a)) {
          for (const t of tgts) {
            if (t.hp <= 0) continue;
            fire(s, 'attacking', { subject: a.uid, side: a.side, target: t.uid, source: a.uid });
            fire(s, 'attacked', { subject: t.uid, side: t.side, source: a.uid });
          }
        }
        for (const t of tgts) {
          if (t.hp <= 0) continue;
          total += dealDamage(s, src, t.uid, V(eff.amount), 'effect', { attack: eff.attack, pierce: eff.pierce });
        }
      }
      ctx.lastDamage = total;
      return;
    }
    case 'attack': {
      const a = select(s, eff.attacker ?? 'self', ctx)[0];
      const t = select(s, eff.target, ctx)[0];
      if (a && t) performAttack(s, a.uid, t.uid, eff.amount === undefined ? undefined : V(eff.amount), eff.times === undefined ? 1 : V(eff.times), false);
      return;
    }
    case 'heal': for (const t of select(s, eff.target, ctx)) heal(s, t.uid, V(eff.amount), src); return;
    case 'loseHp': for (const t of select(s, eff.target, ctx)) dealDamage(s, src, t.uid, V(eff.amount), 'loss'); return;
    case 'armor': for (const t of select(s, eff.target, ctx)) gainArmor(s, t.uid, V(eff.amount), src); return;
    case 'restoreArmor': for (const t of select(s, eff.target, ctx)) {
      const n = Math.min(eff.max ?? Infinity, Math.floor((t.lostArmor ?? 0) * eff.fraction));
      t.lostArmor = 0; // several judge branches may match: only the first one restores
      if (n > 0) gainArmor(s, t.uid, n, src);
    } return;
    case 'ward': for (const t of select(s, eff.target, ctx)) { t.ward += V(eff.amount); emit(s, { t: 'ward', target: t.uid, ward: t.ward }); } return;
    case 'status': for (const t of select(s, eff.target, ctx)) applyStatus(s, t.uid, eff.status, V(eff.amount), src); return;
    case 'cleanse': {
      for (const t of select(s, eff.target, ctx)) {
        const list = eff.what === 'debuffs' ? DEBUFFS : eff.what === 'buffs' ? BUFFS : [eff.what];
        for (const st of list) if (t.statuses[st]) { delete t.statuses[st]; emit(s, { t: 'status', target: t.uid, status: st, delta: 0, total: 0 }); }
        if (eff.what === 'debuffs' && t.silenced) { t.silenced = false; }
      }
      return;
    }
    case 'buff': {
      const atk = eff.atk === undefined ? 0 : V(eff.atk);
      const hp = eff.hp === undefined ? 0 : V(eff.hp);
      for (const t of select(s, eff.target, ctx)) {
        if (eff.until === 'turn') t.tempAtk += atk; else t.atkBuff += atk;
        if (hp) { t.hpBuff += hp; t.hp += hp; if (t.hp > maxHpOf(s, t)) t.hp = maxHpOf(s, t); }
        emit(s, { t: 'stats', target: t.uid, atk: atkOf(s, t), hp: t.hp, maxHp: maxHpOf(s, t) });
      }
      return;
    }
    case 'kill': for (const t of select(s, eff.target, ctx)) { if (t.kind === 'unit') { t.hp = 0; emit(s, { t: 'damage', target: t.uid, source: src, amount: 0, hpLoss: 0, armorLoss: 0, warded: false, hp: 0, armor: t.armor, kind: 'loss' }); } } return;
    case 'silence': for (const t of select(s, eff.target, ctx)) silence(s, t); return;
    case 'addKeyword': {
      for (const t of select(s, eff.target, ctx)) {
        const val = eff.value === undefined ? 1 : V(eff.value);
        if (eff.keyword === 'thorns') t.thorns += val;
        else if (eff.keyword === 'growth') t.growth += val;
        else if (eff.keyword === 'ward') { t.ward += val; emit(s, { t: 'ward', target: t.uid, ward: t.ward }); }
        else if (eff.keyword === 'stealth') { t.stealth = true; if (!t.extraKeywords.includes('stealth')) t.extraKeywords.push('stealth'); }
        else if (!t.extraKeywords.includes(eff.keyword)) t.extraKeywords.push(eff.keyword);
        emit(s, { t: 'keyword', target: t.uid, keyword: eff.keyword });
        emit(s, { t: 'stats', target: t.uid, atk: atkOf(s, t), hp: t.hp, maxHp: maxHpOf(s, t) });
      }
      return;
    }
    case 'summon': {
      const side = eff.side === 'enemy' ? other(ctx.side) : ctx.side;
      const n = eff.n === undefined ? 1 : V(eff.n);
      const isEnemyUnit = content().enemies.has(eff.unit);
      for (let k = 0; k < n; k++) {
        let prefer: 'front' | 'back' = 'front';
        if (eff.row === 'back') prefer = 'back';
        else if (eff.row !== 'front') {
          if (isEnemyUnit) prefer = content().enemy(eff.unit).row === 'back' ? 'back' : 'front';
          else prefer = content().card(eff.unit).unit?.prefersBack ? 'back' : 'front';
        }
        const slot = autoSlot(s, side, prefer);
        if (!slot) break;
        placeUnit(s, side, slot.row, slot.slot, {
          def: eff.unit, origin: isEnemyUnit ? 'enemy' : 'token',
          atk: eff.atk === undefined ? undefined : V(eff.atk), hp: eff.hp === undefined ? undefined : V(eff.hp),
        });
      }
      return;
    }
    case 'move': {
      for (const t of select(s, eff.target, ctx)) {
        if (t.kind !== 'unit') continue;
        const to: 'front' | 'back' = eff.to === 'swap' ? (t.row === 'front' ? 'back' : 'front') : eff.to;
        if (t.row === to) continue;
        const slots = emptySlots(s, t.side, to);
        if (!slots.length) continue;
        const sd = s.sides[t.side];
        if (t.row === 'front' || t.row === 'back') sd[t.row][t.slot] = null;
        const ns = middleFirst(slots, to === 'front' ? FRONT : BACK);
        sd[to][ns] = t.uid;
        t.row = to; t.slot = ns;
        emit(s, { t: 'move', uid: t.uid, row: to, slot: ns });
      }
      return;
    }
    case 'bounce': {
      for (const t of select(s, eff.target, ctx)) {
        if (t.kind !== 'unit') continue;
        removeFromBoard(s, t);
        emit(s, { t: 'death', uid: t.uid });
        if (t.side === 'player' && t.card) {
          const card = { uid: t.card.uid, id: t.card.id, up: t.card.up };
          if (s.hand.length < handLimit(s)) { s.hand.push(card); emit(s, { t: 'create', card, to: 'hand' }); }
          else s.discard.push(card);
        }
      }
      return;
    }
    case 'transform': {
      for (const t of select(s, eff.target, ctx)) {
        if (t.kind !== 'unit') continue;
        const isEnemy = content().enemies.has(eff.into);
        const row = t.row as 'front' | 'back', slot = t.slot, side = t.side;
        removeFromBoard(s, t);
        emit(s, { t: 'death', uid: t.uid });
        placeUnit(s, side, row, slot, { def: eff.into, origin: isEnemy ? 'enemy' : 'token' });
      }
      return;
    }
    case 'draw': drawCards(s, V(eff.n)); return;
    case 'discard':
    case 'exhaustCards': {
      const n = Math.min(V(eff.n), s.hand.length);
      const isEx = eff.op === 'exhaustCards';
      if (n <= 0 && eff.op === 'discard' && eff.mode !== 'all') return;
      if (eff.mode === 'choose') {
        if (n <= 0) return;
        setPending(s, task, { kind: 'chooseCards', from: 'hand', cards: [...s.hand], min: n, max: n, purpose: isEx ? 'exhaust' : 'discard' }, eff);
        return;
      }
      const picks = eff.op === 'discard' && eff.mode === 'all' ? [...s.hand] : sample(s.rng, s.hand, n);
      finishHandPick(s, task, eff, picks);
      return;
    }
    case 'create': {
      const n = eff.n === undefined ? 1 : V(eff.n);
      for (let k = 0; k < n; k++) {
        let id: string | undefined;
        if (typeof eff.card === 'string') id = eff.card;
        else id = pick(s.rng, content().filterCards(eff.card.pool, ownColors(s)))?.id;
        if (id) createCard(s, id, eff.to, !!eff.upgraded, !!eff.fleeting);
      }
      return;
    }
    case 'discover': {
      const pool = content().filterCards(eff.pool, ownColors(s));
      const offer = sample(s.rng, pool, eff.n ?? 3).map((d) => ({ uid: newUid(s), id: d.id, up: !!eff.upgraded, free: eff.free || undefined }));
      if (!offer.length) return;
      setPending(s, task, { kind: 'chooseCards', from: 'offer', cards: offer, min: 1, max: 1, purpose: 'discover', offer }, eff);
      return;
    }
    case 'fetch': {
      const pile = eff.from === 'draw' ? s.draw : eff.from === 'discard' ? s.discard : s.exhaust;
      const f = eff.filter;
      const cands = pile.filter((c) => !f || matchCardInst(c, f));
      const n = Math.min(V(eff.n), cands.length);
      if (n <= 0) return;
      if (eff.mode === 'choose') {
        setPending(s, task, { kind: 'chooseCards', from: eff.from, cards: [...cands], min: n, max: n, purpose: 'fetch' }, eff);
        return;
      }
      const picks = eff.mode === 'top' ? cands.slice(-n) : sample(s.rng, cands, n);
      for (const c of picks) moveToHand(s, pile, c);
      return;
    }
    case 'energy': {
      const n = V(eff.n);
      for (let k = 0; k < n; k++) s.sources.push({ color: eff.color ?? 'N', ready: true, temp: true });
      emit(s, { t: 'sources', sources: s.sources.map((x) => ({ ...x })) });
      return;
    }
    case 'gainSource': {
      const n = V(eff.n);
      for (let k = 0; k < n; k++) addSource(s, eff.color === 'best' ? ownColors(s)[0]! : eff.color, true);
      return;
    }
    case 'emberCap': s.emberCap += V(eff.n); return;
    case 'refresh': {
      let n = V(eff.n);
      for (const src2 of s.sources) { if (n <= 0) break; if (!src2.ready && !src2.temp) { src2.ready = true; n--; } }
      emit(s, { t: 'sources', sources: s.sources.map((x) => ({ ...x })) });
      return;
    }
    case 'costMod': {
      const amt = V(eff.amount);
      if (eff.scope === 'nextCard') { s.nextCardCostMod += amt; return; }
      const cands = s.hand.filter((c) => (!eff.filter || matchCardInst(c, eff.filter)) && c.uid !== ctx.card?.uid);
      const targets = eff.scope === 'hand' ? cands : sample(s.rng, cands, 1);
      for (const c of targets) { c.costMod = (c.costMod ?? 0) + amt; c.costModUntil = eff.until; }
      return;
    }
    case 'judge': {
      if (s.cfg.tutorial?.noJudge) { /* still judges; gating only hides UI hints */ }
      const tgt = eff.target ? select(s, eff.target, ctx)[0] : undefined;
      const party: Side = tgt ? tgt.side : ctx.side;
      const card = flipFate(s);
      emit(s, { t: 'judgeFlip', card, party, target: tgt?.uid ?? null });
      spliceNext(task, [{ op: '__rejudgeCheck', stage: 0, branches: eff.branches, party, card, target: tgt?.uid ?? null }]);
      return;
    }
    case 'peek': s.fate.known = Math.min(s.fate.deck.length, Math.max(s.fate.known, V(eff.n))); emit(s, { t: 'fate', action: 'peek', n: s.fate.known }); return;
    case 'stargaze': {
      const n = Math.min(V(eff.n), s.fate.deck.length + s.fate.discard.length);
      if (s.fate.deck.length < n) { s.fate.deck = [...shuffle(s.rng, s.fate.discard.splice(0)), ...s.fate.deck]; }
      if (ctx.side === 'enemy') { enemyStargaze(s, n); return; }
      const cards = fateTop(s, n);
      if (!cards.length) return;
      setPending(s, task, { kind: 'stargaze', cards }, eff);
      return;
    }
    case 'sign': {
      const n = V(eff.n);
      const signs = ctx.side === 'player' ? s.fate.signs : s.sides.enemy.signs;
      for (let k = 0; k < n; k++) {
        const card = flipFate(s);
        if (signs.length >= signCap(s)) s.fate.discard.push(card);
        else signs.push(card);
      }
      emit(s, { t: 'fate', action: 'sign', n: signs.length });
      return;
    }
    case 'fateAdd': {
      const n = eff.n ?? 1;
      for (let k = 0; k < n; k++) {
        const card: FateCard = { suit: eff.suit, rank: eff.rank, id: newUid(s) };
        if (eff.where === 'top') { s.fate.deck.push(card); }
        else s.fate.deck.splice(randInt(s.rng, 0, s.fate.deck.length), 0, card);
      }
      if (eff.where !== 'top') s.fate.known = 0;
      emit(s, { t: 'fate', action: 'add', n });
      return;
    }
    case 'delay': {
      const def = content().card(eff.card);
      const turns = eff.turns === undefined ? def.delay?.turns ?? 1 : V(eff.turns);
      for (const t of select(s, eff.target, ctx)) attachDelay(s, t, eff.card, false, turns, ctx.side);
      return;
    }
    case 'equip': equipCard(s, ctx.side, { uid: newUid(s), id: eff.card, up: !!eff.upgraded }); return;
    case 'weapon': {
      const w = s.sides[ctx.side].equip.weapon;
      if (!w) return;
      if (eff.atk !== undefined) w.atkBonus += V(eff.atk);
      if (eff.range !== undefined) w.rangeBonus += V(eff.range);
      if (eff.durability !== undefined) w.durability += V(eff.durability);
      emitWeapon(s, ctx.side);
      return;
    }
    case 'destroyEquip': {
      const side = eff.side === 'friendly' ? ctx.side : other(ctx.side);
      const slots = (['weapon', 'armor', 'mount', 'treasure'] as const).filter((k) => s.sides[side].equip[k]);
      const slot = eff.slot === 'random' ? pick(s.rng, slots) : eff.slot;
      if (slot) destroyEquip(s, side, slot);
      return;
    }
    case 'field': setField(s, ctx.side, { uid: newUid(s), id: eff.card, up: false }); return;
    case 'cancel': {
      const link = declaredLink(s, ctx);
      if (link) { link.cancelled = true; emit(s, { t: 'cancel', what: link.kind }); }
      return;
    }
    case 'redirect': {
      const link = declaredLink(s, ctx);
      const to = select(s, eff.to, ctx)[0];
      if (link && to && (link.kind === 'move' || link.kind === 'attack' || link.kind === 'card')) {
        link.target = to.uid;
        emit(s, { t: 'redirect', to: to.uid });
      }
      return;
    }
    case 'repeat': {
      const times = V(eff.times);
      const out: AnyEffect[] = [];
      for (let k = 0; k < times; k++) out.push(...eff.effects);
      spliceNext(task, out);
      return;
    }
    case 'if': spliceNext(task, evalCond(s, eff.cond, ctx) ? eff.then : eff.else ?? []); return;
    case 'choose': {
      if (ctx.side === 'enemy') { spliceNext(task, eff.options[0]!.effects); return; }
      setPending(s, task, { kind: 'chooseOption', options: eff.options.map((o) => o.text) }, eff);
      return;
    }
    case 'forEach': {
      const list = select(s, eff.sel, ctx);
      const out: AnyEffect[] = [];
      for (const u of list) out.push({ op: '__it', uid: u.uid }, ...eff.effects);
      out.push({ op: '__it', uid: null });
      spliceNext(task, out);
      return;
    }
    case 'store': ctx.vars[eff.key] = V(eff.value); return;
    case 'counter': {
      const amt = V(eff.amount);
      let val = 0;
      if (ctx.owner?.kind === 'relic') { const r = s.relics.find((x) => x.id === ctx.owner!.ref); if (r) { r.counter += amt; val = r.counter; if (eff.max && r.counter >= eff.max) { r.counter -= eff.max; spliceNext(task, eff.then ?? []); } emit(s, { t: 'relic', id: r.id }); } }
      else if (ctx.owner?.kind === 'unit') { const u = unit(s, ctx.owner.ref as number); if (u) { u.counter += amt; val = u.counter; if (eff.max && u.counter >= eff.max) { u.counter -= eff.max; spliceNext(task, eff.then ?? []); } } }
      void val;
      return;
    }
    case 'gold': s.goldGained += V(eff.n); return;
    case 'script': runScript(s, task, eff.id, eff.args ?? {}); return;
    // ── internal ──
    case '__it': ctx.it = eff.uid; return;
    case '__evCard': ctx.event = { source: null, target: null, amount: 0, ...(ctx.event ?? {}), card: eff.card }; return;
    case '__judgeSet': ctx.judge = eff.card; return;
    case '__judgeEnd': {
      const card = eff.card;
      s.fate.discard.push(card);
      s.stats.judgesThisTurn[card.suit] = (s.stats.judgesThisTurn[card.suit] ?? 0) + 1;
      emit(s, { t: 'judgeResult', card, branch: eff.branch });
      fire(s, 'judged', { side: ctx.side, suit: card.suit, judge: card, subject: ctx.target });
      return;
    }
    case '__rejudgeCheck': return rejudgeStep(s, task, eff);
    case '__summonCard': {
      const card = ctx.card!;
      const def = cardDef(card);
      const slot = eff.slot ?? autoSlot(s, ctx.side, def.unit?.prefersBack ? 'back' : 'front');
      if (!slot) { ctx.source = null; return; }
      const u = placeUnit(s, ctx.side, slot.row, slot.slot, { def: card.id, origin: 'card', up: card.up, card });
      ctx.source = u.uid;
      return;
    }
    case '__equipCard': equipCard(s, ctx.side, ctx.card!); return;
    case '__attachDelay': {
      const t = unit(s, ctx.target);
      const def = cardDef(ctx.card!);
      if (t) attachDelay(s, t, ctx.card!.id, ctx.card!.up, def.delay?.turns ?? 1, ctx.side);
      return;
    }
    case '__setField': setField(s, ctx.side, ctx.card!); return;
    case '__finishCard': finishCard(s, ctx, eff.exhaust); return;
    case '__attack': {
      const a = unit(s, eff.attacker), t = unit(s, eff.target);
      if (alive(a) && alive(t)) performAttack(s, a.uid, t.uid);
      return;
    }
    case '__move': return;
  }
}

/**
 * Ops that act on the player's deck / hand / sources / fate knowledge. When they run for the enemy side
 * (a player-style equip, field or unit owned by the enemy) they must not help the player: `draw` draws
 * from the enemy commander's deck, `energy` / `gainSource` feed the enemy's energy, the rest do nothing.
 * `create` stays as is — enemies deliberately shuffle status cards into the player's piles.
 */
function enemyResourceOp(s: CombatState, eff: AnyEffect, V: (v: Parameters<typeof evalValue>[1]) => number): boolean {
  const sd = s.sides.enemy;
  switch (eff.op) {
    case 'draw': {
      const n = V(eff.n);
      for (let k = 0; k < n && sd.hand.length < 10; k++) {
        if (!sd.deck.length) {
          const boss = unit(s, sd.commander);
          const ids = boss?.origin === 'enemy' ? content().enemy(boss.def).deck ?? [] : [];
          if (!ids.length) break;
          sd.deck = shuffle(s.rng, ids.map((id) => ({ uid: newUid(s), id, up: false })));
        }
        sd.hand.push(sd.deck.pop()!);
      }
      return true;
    }
    case 'energy': case 'gainSource': sd.energy += V(eff.n); return true;
    case 'discard': case 'exhaustCards': case 'fetch': case 'discover': case 'refresh': case 'costMod': case 'emberCap': case 'gold': case 'peek':
      return true;
  }
  return false;
}

function matchCardInst(c: CardInst, f: CardFilter) {
  return matchCard(cardDef(c), f);
}

function moveToHand(s: CombatState, pile: CardInst[], c: CardInst) {
  const i = pile.findIndex((x) => x.uid === c.uid);
  if (i < 0) return;
  pile.splice(i, 1);
  if (s.hand.length >= handLimit(s)) { s.discard.push(c); return; }
  s.hand.push(c);
  emit(s, { t: 'create', card: c, to: 'hand' });
}

function finishHandPick(s: CombatState, task: FxTask, eff: Extract<Effect, { op: 'discard' | 'exhaustCards' }>, picks: CardInst[]) {
  const follow: AnyEffect[] = [];
  for (const c of picks) {
    if (eff.op === 'discard') discardCard(s, c); else exhaustCard(s, c);
    if (eff.each) follow.push({ op: '__evCard', card: c }, ...eff.each);
  }
  task.ctx.selected = picks.length;
  spliceNext(task, follow);
}

function declaredLink(s: CombatState, ctx: Ctx): ChainLink | undefined {
  if (!ctx.declared) return undefined;
  for (let i = s.tasks.length - 1; i >= 0; i--) {
    const t = s.tasks[i]!;
    if (t.k === 'chain') return t.links[ctx.declared.link] ?? t.resolvedBase;
  }
  return undefined;
}

function attachDelay(s: CombatState, t: Unit, card: string, up: boolean, turns: number, owner: Side) {
  if (t.delays.length >= 3) return;
  t.delays.push({ uid: newUid(s), card, up, turns, owner });
  emit(s, { t: 'delay', target: t.uid, card, turns });
}

export function equipCard(s: CombatState, side: Side, card: CardInst) {
  const def = cardDef(card);
  const slot = def.equip?.slot;
  if (!slot) return;
  if (s.sides[side].equip[slot]) destroyEquip(s, side, slot);
  s.sides[side].equip[slot] = { uid: card.uid, card: card.id, up: card.up, durability: def.equip?.durability ?? 0, atkBonus: 0, rangeBonus: 0, ts: newTs(s) };
  emit(s, { t: 'equip', side, slot, card: card.id });
  if (slot === 'weapon') emitWeapon(s, side);
  fire(s, 'equipped', { side, card });
}

function setField(s: CombatState, side: Side, card: CardInst) {
  const sd = s.sides[side];
  if (sd.field && side === 'player') s.discard.push({ uid: sd.field.uid, id: sd.field.card, up: sd.field.up });
  const def = cardDef(card);
  sd.field = { uid: card.uid, card: card.id, up: card.up, turns: def.field?.duration ?? null, ts: newTs(s) };
  emit(s, { t: 'field', side, card: card.id });
}

function finishCard(s: CombatState, ctx: Ctx, forceExhaust: boolean) {
  const card = ctx.card!;
  const def = cardDef(card);
  const li = s.limbo.findIndex((c) => c.uid === card.uid);
  if (li >= 0) s.limbo.splice(li, 1);
  let to: 'discard' | 'exhaust' | 'board' = 'discard';
  if (def.type === 'unit' || def.type === 'equip' || def.type === 'field') to = 'board';
  if (def.type === 'delay') to = 'board';
  if (forceExhaust || (def.keywords ?? []).includes('exhaust') || card.fleeting) to = 'exhaust';
  if (def.type === 'unit' && ctx.source == null) to = 'discard';
  if (ctx.side === 'player') {
    if (to === 'discard') s.discard.push(stripTemp(card));
    else if (to === 'exhaust') { s.exhaust.push(card); fire(s, 'cardExhausted', { side: 'player', card }); }
    else if (def.type === 'delay') {/* returns to discard when the delay resolves */}
    s.cardsPlayedThisTurn += 1;
    s.stats.cardsPlayed += 1;
  }
  emit(s, { t: 'cardDone', card, to });
  fire(s, 'cardPlayed', { side: ctx.side, card, target: ctx.target });
}

function stripTemp(c: CardInst): CardInst {
  const out: CardInst = { uid: c.uid, id: c.id, up: c.up };
  if (c.costModUntil === 'combat') { out.costMod = c.costMod; out.costModUntil = 'combat'; }
  return out;
}

// ── rejudge windows ──

function rejudgeStep(s: CombatState, task: FxTask, eff: Extract<InternalEffect, { op: '__rejudgeCheck' }>) {
  // stage 0: opponent of the judged party; stage 1: the party itself; stage 2: finalize
  if (eff.stage >= 2) {
    const card = eff.card;
    const b = eff.branches;
    const branch = branchName(card);
    const out: AnyEffect[] = [{ op: '__judgeSet', card }];
    const yang = YANG.includes(card.suit);
    const rankBonus = sumMods(s, 'judgeRank', 'player');
    const rank = Math.min(13, card.rank + (eff.party === 'player' ? rankBonus : 0));
    if (card.omen) {
      // 凶兆: counts as the worst branch for the player
      const bad = eff.party === 'player' ? (b.yin ?? b.low ?? []) : (b.yang ?? b.high ?? []);
      out.push(...bad);
    } else {
      const suitB = b[card.suit];
      if (suitB) out.push(...suitB);
      if (yang && b.yang) out.push(...b.yang);
      if (!yang && b.yin) out.push(...b.yin);
      if (rank >= 8 && b.high) out.push(...b.high);
      if (rank <= 7 && b.low) out.push(...b.low);
      for (const r of b.ranks ?? []) if (rank >= r.min && rank <= r.max) out.push(...r.effects);
    }
    if (b.always) out.push(...b.always);
    out.push({ op: '__judgeEnd', card, branch });
    task.ctx.judge = card;
    spliceNext(task, out);
    return;
  }
  const chooser: Side = eff.stage === 0 ? other(eff.party) : eff.party;
  const next = { ...eff, stage: eff.stage + 1 };
  if (chooser === 'player' && s.fate.signs.length > 0 && !s.cfg.tutorial?.noJudge) {
    task.effects.splice(task.i, 0, next);
    setPending(s, task, { kind: 'rejudge', card: eff.card, signs: [...s.fate.signs] }, next);
    return;
  }
  if (chooser === 'enemy' && s.sides.enemy.signs.length > 0) {
    const swap = enemyRejudge(s, eff);
    if (swap !== null) {
      const now = s.sides.enemy.signs.splice(swap, 1)[0]!;
      s.fate.discard.push(eff.card);
      emit(s, { t: 'rejudge', old: eff.card, now, side: 'enemy' });
      fire(s, 'rejudged', { side: 'enemy', suit: now.suit });
      next.card = now;
    }
  }
  task.effects.splice(task.i, 0, next);
}

function branchName(c: FateCard): string {
  return c.omen ? 'omen' : c.suit;
}

/** simple heuristic: enemy prefers yang when it is the party (their curses/omens use yang for good), else yin */
function enemyRejudge(s: CombatState, eff: Extract<InternalEffect, { op: '__rejudgeCheck' }>): number | null {
  const signs = s.sides.enemy.signs;
  const want = eff.party === 'enemy' ? YANG : (['moon', 'mountain'] as Suit[]);
  if (want.includes(eff.card.suit)) return null;
  const i = signs.findIndex((c) => want.includes(c.suit));
  return i >= 0 ? i : null;
}

function enemyStargaze(s: CombatState, n: number) {
  // enemy places yin cards (bad for player judgements) on top
  const top = s.fate.deck.splice(-n);
  top.sort((a, b) => (YANG.includes(a.suit) ? 0 : 1) - (YANG.includes(b.suit) ? 0 : 1));
  s.fate.deck.push(...top);
  s.fate.known = 0;
  emit(s, { t: 'fate', action: 'arrange', n });
}

// ── scripts (TS extension points for complex cards) ──

type ScriptFn = (s: CombatState, task: FxTask, args: Record<string, unknown>) => void;
const scripts = new Map<string, ScriptFn>();
export function registerScript(id: string, fn: ScriptFn) { scripts.set(id, fn); }

function runScript(s: CombatState, task: FxTask, id: string, args: Record<string, unknown>) {
  if (id === '__awaken') {
    const i = args.skill as number;
    const sk = s.skills[i];
    if (!sk || sk.awakened) return;
    const def = skillDef(s, sk);
    sk.awakened = true;
    emit(s, { t: 'skill', index: i });
    emit(s, { t: 'log', text: `觉醒：${def?.name ?? ''}` });
    if (def?.awaken?.effects) spliceNext(task, def.awaken.effects);
    return;
  }
  const fn = scripts.get(id);
  if (!fn) throw new Error(`unknown script ${id}`);
  fn(s, task, args);
}

// ═════════════ decisions ═════════════

export function answerDecision(s: CombatState, a: import('./state').PlayerAction): string | null {
  const d = s.pending;
  const pc = s.pendingCtx;
  if (!d || !pc) return 'no pending decision';
  const task = s.tasks[pc.task];
  if (d.kind === 'response') return answerResponse(s, a);
  if (!task || task.k !== 'fx') return 'bad pending task';
  const eff = pc.effect;
  switch (d.kind) {
    case 'chooseCards': {
      if (a.type !== 'choose') return 'expected choose';
      const picks = a.picks.map((uid) => d.cards.find((c) => c.uid === uid)).filter((c): c is CardInst => !!c);
      if (new Set(a.picks).size !== a.picks.length || picks.length < d.min || picks.length > d.max) return 'bad selection';
      s.pending = null; s.pendingCtx = null;
      if (d.purpose === 'discover') {
        const c = picks[0]!;
        if (s.hand.length < handLimit(s)) { s.hand.push(c); emit(s, { t: 'create', card: c, to: 'hand' }); }
        else s.discard.push(c);
      } else if (d.purpose === 'fetch') {
        const e = eff as Extract<Effect, { op: 'fetch' }>;
        const pile = e.from === 'draw' ? s.draw : e.from === 'discard' ? s.discard : s.exhaust;
        for (const c of picks) moveToHand(s, pile, c);
      } else {
        finishHandPick(s, task, eff as Extract<Effect, { op: 'discard' | 'exhaustCards' }>, picks);
      }
      return null;
    }
    case 'chooseOption': {
      if (a.type !== 'choose') return 'expected choose';
      const e = eff as Extract<Effect, { op: 'choose' }>;
      const opt = e.options[a.picks[0] ?? -1];
      if (!opt) return 'bad option';
      s.pending = null; s.pendingCtx = null;
      spliceNext(task, opt.effects);
      return null;
    }
    case 'stargaze': {
      if (a.type !== 'arrange') return 'expected arrange';
      const ids = [...a.top, ...a.bottom].sort();
      const have = d.cards.map((c) => c.id).sort();
      if (ids.join() !== have.join()) return 'bad arrangement';
      s.pending = null; s.pendingCtx = null;
      s.fate.deck.splice(-d.cards.length);
      const byId = new Map(d.cards.map((c) => [c.id, c] as const));
      const bottom = a.bottom.map((id) => byId.get(id)!);
      const top = a.top.map((id) => byId.get(id)!);
      s.fate.deck.unshift(...bottom.reverse());
      s.fate.deck.push(...[...top].reverse());
      s.fate.known = Math.max(s.fate.known, top.length);
      emit(s, { t: 'fate', action: 'arrange', n: d.cards.length });
      return null;
    }
    case 'rejudge': {
      if (a.type !== 'rejudge') return 'expected rejudge';
      const e = eff as Extract<InternalEffect, { op: '__rejudgeCheck' }>;
      s.pending = null; s.pendingCtx = null;
      if (a.sign !== null && a.sign !== undefined) {
        const now = s.fate.signs.splice(a.sign, 1)[0];
        if (now) {
          s.fate.discard.push(e.card);
          emit(s, { t: 'rejudge', old: e.card, now, side: 'player' });
          fire(s, 'rejudged', { side: 'player', suit: now.suit });
          e.card = now;
        }
      }
      return null;
    }
  }
  return 'unhandled';
}

// ═════════════ chains & responses ═════════════

type ChainTask = Extract<Task, { k: 'chain' }>;

export function responseOptions(s: CombatState, chain: ChainTask): number[] {
  if (s.cfg.tutorial?.noResponse) return [];
  const top = chain.links[chain.links.length - 1];
  if (!top) return [];
  const topSide: Side = top.kind === 'move' ? 'enemy' : top.kind === 'attack' ? (unit(s, top.attacker)?.side ?? 'player') : top.side;
  if (topSide !== 'enemy') return [];
  if (chain.links.length >= 4) return [];
  const out: number[] = [];
  for (const card of s.hand) {
    const def = cardDef(card);
    if (!isResponse(def) || def.unplayable) continue;
    const plan = planPayment(s, effectiveCost(s, card), card);
    if (!plan) continue;
    const tg = cardTargets(s, 'player', def);
    if (tg && !tg.length) continue;
    out.push(card.uid);
  }
  return out;
}

export function isResponse(def: CardDef) {
  return def.type === 'response' || (def.keywords ?? []).includes('response');
}

function stepChain(s: CombatState, task: ChainTask) {
  if (task.stage === 'window') {
    const opts = responseOptions(s, task);
    if (opts.length && !s.autoSkipResponse) {
      const top = task.links[task.links.length - 1]!;
      const actor = top.kind === 'move' ? top.uid : top.kind === 'attack' ? top.attacker : s.sides[top.side].commander;
      const target = top.kind === 'skill' ? top.target : top.target;
      s.pending = { kind: 'response', actor, target, options: opts, timer: 8 };
      s.pendingCtx = { task: s.tasks.indexOf(task), effect: null };
      emit(s, { t: 'window', open: true, actor });
      return;
    }
    task.stage = 'resolve';
    return;
  }
  if (task.stage === 'resolve') {
    const link = task.links.pop();
    if (!link) { s.tasks.pop(); return; }
    if (task.links.length === 0) task.resolvedBase = link;
    if (link.cancelled) {
      emit(s, { t: 'cancel', what: link.kind });
      if (link.kind === 'card') finishCancelledCard(s, link);
      return;
    }
    resolveLink(s, task, link);
  }
}

function finishCancelledCard(s: CombatState, link: Extract<ChainLink, { kind: 'card' }>) {
  const li = s.limbo.findIndex((c) => c.uid === link.card.uid);
  if (li >= 0) s.limbo.splice(li, 1);
  if (link.side === 'player') s.discard.push(stripTemp(link.card));
  emit(s, { t: 'cardDone', card: link.card, to: 'discard' });
}

function declaredFor(task: ChainTask, idx: number): Ctx['declared'] {
  const below = task.links[idx - 1];
  if (!below) return undefined;
  if (below.kind === 'move') return { actor: below.uid, target: below.target, link: idx - 1 };
  if (below.kind === 'attack') return { actor: below.attacker, target: below.target, link: idx - 1 };
  if (below.kind === 'card') return { actor: null, target: below.target, link: idx - 1 };
  return { actor: null, target: below.target, link: idx - 1 };
}

function resolveLink(s: CombatState, task: ChainTask, link: ChainLink) {
  const idx = task.links.length; // index the link had
  switch (link.kind) {
    case 'card': {
      const def = cardDef(link.card);
      const ctx = cardCtx(s, link.side, link.card, link.target, link.x);
      ctx.inWindow = !!link.inWindow;
      ctx.declared = declaredFor(task, idx);
      const effs: AnyEffect[] = [];
      if (def.type === 'unit') effs.push({ op: '__summonCard', slot: link.slot });
      if (def.type === 'equip') effs.push({ op: '__equipCard' });
      if (def.type === 'delay') effs.push({ op: '__attachDelay' });
      if (def.type === 'field') effs.push({ op: '__setField' });
      effs.push(...(def.effects ?? []));
      effs.push({ op: '__finishCard', exhaust: false });
      pushFx(s, effs, ctx);
      return;
    }
    case 'move': {
      const u = unit(s, link.uid);
      if (!alive(u)) return;
      const mv = enemyMoves(u)[link.move];
      if (!mv) return;
      if ((u.statuses.stun ?? 0) > 0) { delete u.statuses.stun; u.stunImmune = 2; emit(s, { t: 'status', target: u.uid, status: 'stun', delta: -1, total: 0 }); emit(s, { t: 'stunned', uid: u.uid }); return; }
      if ((u.statuses.freeze ?? 0) > 0 && mv.intent.includes('attack')) { emit(s, { t: 'frozen', uid: u.uid }); return; }
      s.acted = true;
      pushFx(s, mv.effects, { side: u.side, source: u.uid, kind: 'move', target: link.target, vars: { atk: atkOf(s, u) } });
      return;
    }
    case 'attack': pushFx(s, [{ op: '__attack', attacker: link.attacker, target: link.target }], baseCtx(s, unit(s, link.attacker)?.side ?? 'player', 'system')); return;
    case 'skill': {
      const sk = s.skills[link.skill];
      const def = sk ? skillDef(s, sk) : undefined;
      if (!def) return;
      pushFx(s, def.effects ?? [], { ...baseCtx(s, link.side, 'skill'), target: link.target, owner: { kind: 'skill', ref: link.skill } });
      return;
    }
  }
}

function answerResponse(s: CombatState, a: import('./state').PlayerAction): string | null {
  const pc = s.pendingCtx!;
  const task = s.tasks[pc.task] as ChainTask | undefined;
  if (!task || task.k !== 'chain') return 'bad chain';
  if (a.type === 'pass') {
    s.pending = null; s.pendingCtx = null;
    task.stage = 'resolve';
    emit(s, { t: 'window', open: false });
    return null;
  }
  if (a.type !== 'respond') return 'expected respond/pass';
  const card = s.hand.find((c) => c.uid === a.card);
  if (!card || !(s.pending as Extract<CombatState['pending'], { kind: 'response' }>)!.options.includes(card.uid)) return 'not a legal response';
  const def = cardDef(card);
  const tg = cardTargets(s, 'player', def);
  const target = a.target ?? null;
  if (tg && (target === null || !tg.includes(target))) return 'bad target';
  const need = effectiveCost(s, card);
  const plan = planPayment(s, need, card);
  if (!plan) return 'cannot pay';
  s.pending = null; s.pendingCtx = null;
  const x = need.x ? plan.length - need.c.length : 0;
  paySources(s, plan);
  s.nextCardCostMod = 0;
  s.hand.splice(s.hand.indexOf(card), 1);
  s.limbo.push(card);
  task.links.push({ kind: 'card', side: 'player', card, target, slot: null, x, inWindow: true });
  s.stats.responses += 1;
  emit(s, { t: 'response', side: 'player', card });
  emit(s, { t: 'window', open: false });
  fire(s, 'responsePlayed', { side: 'player', card });
  return null;
}

// ═════════════ turn flow ═════════════

function stepPhase(s: CombatState, name: import('./state').PhaseName) {
  s.tasks.pop();
  switch (name) {
    case 'combatStart': {
      for (const u of unitsOf(s, 'enemy', true)) if (!u.intent) rollIntent(s, u);
      fire(s, 'combatStart', { side: 'player' });
      return;
    }
    case 'playerTurnStart': {
      s.turn += 1;
      s.stats.turns = s.turn;
      s.active = 'player';
      s.stats.judgesThisTurn = {};
      s.sacrificesThisTurn = 0;
      s.cardsPlayedThisTurn = 0;
      for (const k of Object.keys(s.triggerUse)) if (!k.startsWith('combat:')) delete s.triggerUse[k];
      emit(s, { t: 'turn', side: 'player', turn: s.turn });
      s.sources = s.sources.filter((x) => !x.temp);
      for (const src of s.sources) src.ready = true;
      emit(s, { t: 'sources', sources: s.sources.map((x) => ({ ...x })) });
      for (const sk of s.skills) sk.used = false;
      s.tasks.push({ k: 'phase', name: 'playerDraw' });
      startOfTurn(s, 'player');
      return;
    }
    case 'playerDraw': {
      const n = 5 + sumMods(s, 'draw', 'player');
      drawCards(s, n);
      return;
    }
    case 'playerTurnEnd': {
      s.tasks.push({ k: 'phase', name: 'playerCleanup' });
      endOfTurn(s, 'player');
      return;
    }
    case 'playerCleanup': {
      // embers
      const cap = emberCap(s);
      s.sources = s.sources.filter((x) => !x.temp);
      const ready = s.sources.map((x, i) => ({ x, i })).filter((p) => p.x.ready);
      const wanted = new Set<Color>();
      for (const c of s.hand) { const d = cardDef(c); if (isResponse(d)) for (const col of d.cost.c ?? []) wanted.add(col); }
      ready.sort((a, b) => (wanted.has(a.x.color) ? 0 : 1) - (wanted.has(b.x.color) ? 0 : 1) || a.i - b.i);
      ready.forEach((p, k) => { if (k >= cap) p.x.ready = false; });
      emit(s, { t: 'sources', sources: s.sources.map((x) => ({ ...x })) });
      emit(s, { t: 'embers', count: Math.min(cap, ready.length) });
      // hand
      const retainAll = sumMods(s, 'retainHand', 'player') > 0;
      for (const c of [...s.hand]) {
        const d = cardDef(c);
        const kws = d.keywords ?? [];
        if (kws.includes('ethereal') || c.fleeting) { exhaustCard(s, c); continue; }
        if (kws.includes('retain') || retainAll) continue;
        if (isResponse(d)) { c.held = true; continue; }
        discardCard(s, c, true);
      }
      for (const c of [...s.hand, ...s.draw, ...s.discard]) if (c.costModUntil === 'turn') { c.costMod = 0; c.costModUntil = undefined; }
      for (const c of s.hand) if (c.free) c.free = undefined;
      s.nextCardCostMod = 0;
      s.tasks.push({ k: 'phase', name: 'enemyTurnStart' });
      return;
    }
    case 'enemyTurnStart': {
      s.active = 'enemy';
      emit(s, { t: 'turn', side: 'enemy', turn: s.turn });
      advanceEnemies(s);
      s.tasks.push({ k: 'phase', name: 'enemyActions' });
      startOfTurn(s, 'enemy');
      return;
    }
    case 'enemyActions': {
      s.tasks.push({ k: 'phase', name: 'enemyTurnEnd' });
      const order = unitsOf(s, 'enemy', true);
      for (let i = order.length - 1; i >= 0; i--) s.tasks.push({ k: 'enemyAct', uid: order[i]!.uid });
      return;
    }
    case 'enemyTurnEnd': {
      s.tasks.push({ k: 'phase', name: 'playerTurnStart' });
      endOfTurn(s, 'enemy');
      for (const src of s.sources) src.ready = false;
      for (const c of [...s.hand]) if (c.held) { c.held = undefined; discardCard(s, c, true); }
      for (const u of unitsOf(s, 'enemy', true)) rollIntent(s, u);
      return;
    }
  }
}

function advanceEnemies(s: CombatState) {
  const sd = s.sides.enemy;
  for (let j = 0; j < BACK; j++) {
    const u = unit(s, sd.back[j]);
    if (!alive(u) || u.origin !== 'enemy' || hasKw(s, u, 'ranged')) continue;
    const def = content().enemy(u.def);
    if (def.row === 'back') continue;
    const free = emptySlots(s, 'enemy', 'front');
    if (!free.length) return;
    const ns = free.includes(j) ? j : free.includes(j + 1) ? j + 1 : free[0]!;
    sd.back[j] = null;
    sd.front[ns] = u.uid;
    u.row = 'front'; u.slot = ns;
    emit(s, { t: 'move', uid: u.uid, row: 'front', slot: ns });
  }
}

function startOfTurn(s: CombatState, side: Side) {
  s.acted = false;
  const chars = boardOrder(s, side);
  // armor expires — except on the player's very first turn: armor granted at combat start
  // (combatStart triggers resolve just before this phase) has not lived through a turn yet
  const keep = side === 'player' ? (s.turn <= 1 ? 999 : sumMods(s, 'armorKeep', 'player')) : 0;
  for (const u of chars) {
    if (u.armor > 0) {
      const kept = keep >= 999 ? u.armor : Math.min(u.armor, keep);
      u.lostArmor = u.armor - kept;
      if (kept !== u.armor) { u.armor = kept; emit(s, { t: 'armor', target: u.uid, amount: 0, armor: u.armor }); }
    } else u.lostArmor = 0;
    u.attacks = 0;
  }
  // growth
  for (const u of chars) {
    if (u.growth > 0 && !u.silenced && u.kind === 'unit') {
      u.atkBuff += u.growth; u.hpBuff += u.growth; u.hp += u.growth;
      emit(s, { t: 'keyword', target: u.uid, keyword: 'growth' });
      emit(s, { t: 'stats', target: u.uid, atk: atkOf(s, u), hp: u.hp, maxHp: maxHpOf(s, u) });
    }
  }
  // burn
  for (const u of chars) {
    const b = u.statuses.burn ?? 0;
    if (b > 0 && alive(u)) {
      dealDamage(s, null, u.uid, b, 'burn');
      emit(s, { t: 'keyword', target: u.uid, keyword: 'burn' });
      const keepBurn = sumMods(s, 'burnKeep', u.side, u) > 0;
      const nb = keepBurn ? b : Math.floor(b / 2);
      if (nb <= 0) delete u.statuses.burn; else u.statuses.burn = nb;
      emit(s, { t: 'status', target: u.uid, status: 'burn', delta: nb - b, total: nb });
    }
  }
  checkState(s);
  if (s.over) return;
  // field duration
  const f = s.sides[side].field;
  if (f && f.turns !== null) {
    f.turns -= 1;
    if (f.turns <= 0) { s.sides[side].field = null; emit(s, { t: 'field', side, card: null }); if (side === 'player') s.discard.push({ uid: f.uid, id: f.card, up: f.up }); }
  }
  // delays (queued in board order, first resolves first)
  const jobs: { effs: AnyEffect[]; ctx: Ctx }[] = [];
  for (const u of chars) {
    if (!alive(u)) continue;
    for (const d of [...u.delays]) {
      d.turns -= 1;
      emit(s, { t: 'delayTick', target: u.uid, card: d.card, turns: d.turns });
      if (d.turns <= 0) {
        u.delays.splice(u.delays.indexOf(d), 1);
        const def = content().card(d.card, d.up);
        if (d.owner === 'player') s.discard.push({ uid: d.uid, id: d.card, up: d.up });
        jobs.push({
          effs: [{ op: 'judge', branches: def.delay!.branches, target: 'target' }],
          ctx: { side: d.owner, source: s.sides[d.owner].commander, kind: 'delay', target: u.uid, vars: { ...(def.vars ?? {}) }, defId: d.card, up: d.up },
        });
      }
    }
  }
  for (let i = jobs.length - 1; i >= 0; i--) pushFx(s, jobs[i]!.effs, jobs[i]!.ctx);
  fire(s, 'turnStart', { side });
}

function endOfTurn(s: CombatState, side: Side) {
  const chars = boardOrder(s, side);
  for (const u of chars) {
    const p = u.statuses.poison ?? 0;
    if (p > 0) {
      dealDamage(s, null, u.uid, p, 'poison');
      emit(s, { t: 'keyword', target: u.uid, keyword: 'poison' });
      decStatus(s, u, 'poison');
    }
    const r = u.statuses.regen ?? 0;
    if (r > 0 && alive(u)) { heal(s, u.uid, r); decStatus(s, u, 'regen'); }
  }
  for (const u of chars) {
    // stun = "skip the next action". Enemies consume it when they would act (stepEnemyAct); player
    // characters have no scripted action, so a stun is spent by sitting out one player turn.
    if (side === 'player' && (u.statuses.stun ?? 0) > 0) {
      delete u.statuses.stun;
      u.stunImmune = 2;
      emit(s, { t: 'status', target: u.uid, status: 'stun', delta: -1, total: 0 });
    }
    for (const st of ['freeze', 'vulnerable', 'weak'] as StatusId[]) {
      if (u.fresh?.[st]) { delete u.fresh[st]; continue; }
      if ((u.statuses[st] ?? 0) > 0) decStatus(s, u, st);
    }
    if (u.stunImmune > 0) u.stunImmune -= 1;
    if (u.tempAtk) { u.tempAtk = 0; emit(s, { t: 'stats', target: u.uid, atk: atkOf(s, u), hp: u.hp, maxHp: maxHpOf(s, u) }); }
  }
  checkState(s);
  if (s.over) return;
  fire(s, 'turnEnd', { side });
}

function decStatus(s: CombatState, u: Unit, st: StatusId) {
  const v = (u.statuses[st] ?? 0) - 1;
  if (v <= 0) delete u.statuses[st]; else u.statuses[st] = v;
  emit(s, { t: 'status', target: u.uid, status: st, delta: -1, total: Math.max(0, v) });
}

function stepEnemyAct(s: CombatState, uid: number) {
  s.tasks.pop();
  const u = unit(s, uid);
  if (!alive(u) || !u.intent) return;
  const mv = enemyMoves(u)[u.intent.move];
  if (!mv) return;
  if ((u.statuses.stun ?? 0) > 0) {
    delete u.statuses.stun;
    u.stunImmune = 2;
    emit(s, { t: 'status', target: u.uid, status: 'stun', delta: -1, total: 0 });
    emit(s, { t: 'stunned', uid: u.uid });
    return;
  }
  if ((u.statuses.freeze ?? 0) > 0 && mv.intent.includes('attack')) {
    emit(s, { t: 'frozen', uid: u.uid });
    return;
  }
  const target = retarget(s, u, mv);
  u.intent.target = target;
  emit(s, { t: 'declare', uid: u.uid, move: u.intent.move, target });
  fire(s, 'actionDeclared', { subject: u.uid, side: 'enemy', target, source: u.uid });
  s.tasks.push({ k: 'chain', stage: 'window', links: [{ kind: 'move', uid: u.uid, move: u.intent.move, target }], passes: 0, origin: 'enemy' });
}

// ═════════════ main loop ═════════════

export function run(s: CombatState) {
  let guard = 0;
  while (!s.pending && !s.over) {
    if (++guard > 50000) throw new Error('engine loop overflow');
    const top = s.tasks[s.tasks.length - 1];
    if (!top || top.k !== 'fx') {
      const t = s.triggers.shift();
      if (t) { pushFx(s, t.effects, t.ctx); continue; }
      if (s.ending) {
        s.over = 'win'; s.phase = 'over';
        emit(s, { t: 'end', result: 'win' });
        return;
      }
      if (enemyDefeated(s)) {
        s.ending = true;
        // remaining minions flee
        for (const u of unitsOf(s, 'enemy')) { removeFromBoard(s, u); emit(s, { t: 'death', uid: u.uid }); }
        fire(s, 'combatEnd', { side: 'player' });
        continue;
      }
    }
    if (!top) { s.phase = 'main'; return; }
    s.phase = 'busy';
    switch (top.k) {
      case 'fx': {
        if (top.i >= top.effects.length) { s.tasks.pop(); checkState(s); break; }
        const eff = top.effects[top.i++]!;
        execEffect(s, top, eff);
        break;
      }
      case 'phase': stepPhase(s, top.name); break;
      case 'enemyAct': stepEnemyAct(s, top.uid); break;
      case 'chain': stepChain(s, top); break;
    }
  }
}

// re-exports for other engine modules
export { cardCtx, paySources, spliceNext, stepChain };
export type { FxTask, ChainTask };
export const _internal = { discardCard, exhaustCard, attachDelay, setField, finishCard, depth, attackTargets, isAttackKind };
export type { IntentType, EnemyMove, JudgeBranches };
