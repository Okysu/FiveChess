/** Public combat API: create a combat, apply player actions, query legal moves. */
import { content } from '../content';
import type { Color, Effect } from '../defs';
import { rand, seedRng, shuffle } from '../rng';
import type { CardInst, CombatConfig, CombatState, CEvent, Ctx, PlayerAction, Side, Unit, SideState } from './state';
import { other } from './state';
import {
  alive, attackTargets, canAttack, commanderOf, emptySlots, unit, unitsOf, BACK, FRONT, reach,
} from './board';
import {
  answerDecision, cardCtx, cardDef, cardTargets, effectiveCost, emit, fire, isResponse, newTs, newUid, planPayment,
  paySources, pushFx, run, addSource, emberCap,
} from './core';
import { skillDef } from './skills';
import './enemycast';
import './bossScripts';

function emptySide(): SideState {
  return { commander: null, front: Array(FRONT).fill(null), back: Array(BACK).fill(null), equip: {}, field: null, hand: [], deck: [], energy: 0, signs: [] };
}

export function createCombat(cfg: CombatConfig): CombatState {
  const c = content();
  const cmdDef = c.commander(cfg.commander);
  const s: CombatState = {
    v: 1, seed: cfg.seed, rng: seedRng(cfg.seed), cfg, turn: 0, active: 'player', phase: 'busy', over: null,
    nextUid: 1, nextTs: 10, units: {}, sides: { player: emptySide(), enemy: emptySide() },
    draw: [], hand: [], discard: [], exhaust: [], sacrificed: [], limbo: [],
    sources: [], emberCap: 2 + (cfg.emberCapBonus ?? 0) - (cfg.ascension >= 7 ? 1 : 0),
    sacrificesThisTurn: 0, cardsPlayedThisTurn: 0, nextCardCostMod: 0,
    fate: { deck: [], discard: [], known: 0, signs: [] },
    skills: [], relics: cfg.relics.map((r) => ({ ...r })), potions: [...cfg.potions],
    tasks: [], triggers: [], pending: null, pendingCtx: null, triggerUse: {},
    stats: { judgesThisTurn: {}, dead: 0, responses: 0, damageDealt: 0, damageTaken: 0, cardsPlayed: 0, turns: 0 },
    goldGained: 0, events: [], log: [], actions: [],
  };
  // player commander
  const pc: Unit = {
    uid: newUid(s), side: 'player', kind: 'commander', def: cmdDef.id, origin: 'commander', up: false, name: cmdDef.name,
    row: 'cmd', slot: 0, baseAtk: 0, baseMaxHp: cfg.maxHp, hp: cfg.hp, armor: 0, atkBuff: 0, hpBuff: 0, tempAtk: 0, ward: 0,
    thorns: 0, growth: 0, statuses: {}, extraKeywords: [], silenced: false, stealth: false, ts: 0, enteredTurn: 0, attacks: 0,
    stunImmune: 0, delays: [], counter: 0, essential: true,
  };
  s.units[pc.uid] = pc;
  s.sides.player.commander = pc.uid;
  // skills
  const alt = cfg.altSkill ? cmdDef.alt : undefined;
  cmdDef.skills.forEach((sk) => s.skills.push({ id: alt && alt.replaces === sk.id ? alt.skill.id : sk.id, used: false, usedCombat: false, awakened: false, from: 'commander' }));
  if (cfg.lieutenant) {
    const l = c.lieutenants.get(cfg.lieutenant);
    if (l) s.skills.push({ id: l.skill.id, used: false, usedCombat: false, awakened: false, from: 'lieutenant' });
  }
  // sources
  const srcs: Color[] = [...cmdDef.sources];
  if (cfg.lieutenant) {
    const l = c.lieutenants.get(cfg.lieutenant);
    const ni = srcs.indexOf('N');
    if (l && ni >= 0) srcs[ni] = l.faction;
  }
  srcs.push(...(cfg.extraStartSources ?? []));
  if (cfg.ascension >= 11 && srcs.length > 1) srcs.pop();
  for (const col of srcs) s.sources.push({ color: col, ready: true });
  // deck
  const deck: CardInst[] = cfg.deck.map((d) => ({ uid: newUid(s), id: d.id, up: d.up }));
  shuffle(s.rng, deck);
  const innate = deck.filter((d) => (cardDef(d).keywords ?? []).includes('innate'));
  const rest = deck.filter((d) => !innate.includes(d));
  s.draw = [...rest, ...innate]; // top of draw pile = end of array
  // fate
  s.fate.deck = shuffle(s.rng, cfg.fateDeck.map((f) => ({ ...f, id: newUid(s) })));
  // enemies
  const enc = c.encounters.get(cfg.encounter);
  if (!enc) throw new Error(`unknown encounter ${cfg.encounter}`);
  const counters = { front: 0, back: 0 };
  for (const e of enc.enemies) {
    let def = c.enemy(e.id);
    // 迷途执命者: a shadow of a commander the player is not playing
    if (def.variants?.length) def = c.enemy(pickVariant(s, def.variants, cmdDef.id));
    const row = e.row ?? def.row;
    if (row === 'commander') {
      const hp = scaleEnemyHp(s, def.tier, def.hp[0]);
      const boss: Unit = {
        uid: newUid(s), side: 'enemy', kind: 'commander', def: def.id, origin: 'enemy', up: false, name: def.name, row: 'cmd', slot: 0,
        baseAtk: def.atk, baseMaxHp: hp, hp, armor: 0, atkBuff: 0, hpBuff: 0, tempAtk: 0, ward: def.ward ?? 0, thorns: def.thorns ?? 0,
        growth: 0, statuses: {}, extraKeywords: [], silenced: false, stealth: false, ts: newTs(s), enteredTurn: 0, attacks: 0,
        stunImmune: 0, delays: [], counter: 0, essential: true, ai: { history: [], fired: [], cycle: 0 }, phase: 0,
      };
      if (cfg.ascension >= 14) boss.ward += 1;
      s.units[boss.uid] = boss;
      s.sides.enemy.commander = boss.uid;
      if (def.deck) {
        s.sides.enemy.deck = shuffle(s.rng, def.deck.map((id) => ({ uid: newUid(s), id, up: false })));
        s.sides.enemy.energy = def.energy?.start ?? 0;
      }
      continue;
    }
    const r: 'front' | 'back' = row === 'back' ? 'back' : 'front';
    const slot = e.slot ?? counters[r]++;
    placeUnitSilently(s, r, slot, def.id);
  }
  const affixJobs = applyAffixes(s);
  s.events = [];
  s.tasks.push({ k: 'phase', name: 'playerTurnStart' });
  s.tasks.push({ k: 'phase', name: 'combatStart' });
  for (const j of affixJobs) pushFx(s, j.effects, j.ctx);
  run(s);
  return s;
}

/** a variant whose commander is not the player's own — another school if possible */
function pickVariant(s: CombatState, ids: string[], commander: string): string {
  const c = content();
  const own = c.commander(commander).faction;
  const others = ids.filter((id) => c.enemy(id).commander !== commander);
  const otherSchool = others.filter((id) => { const cm = c.enemy(id).commander; return !cm || c.commander(cm).faction !== own; });
  const pool = otherSchool.length ? otherSchool : others.length ? others : ids;
  return pool[Math.floor(rand(s.rng) * pool.length)]!;
}

/** 精英词缀: every elite-tier enemy of the fight carries the rolled affixes; their opening effects run first */
function applyAffixes(s: CombatState): { effects: Effect[]; ctx: Ctx }[] {
  const ids = (s.cfg.affixes ?? []).filter((a) => content().affixes.has(a));
  const jobs: { effects: Effect[]; ctx: Ctx }[] = [];
  if (!ids.length) return jobs;
  for (const u of unitsOf(s, 'enemy', true)) {
    if (u.origin !== 'enemy' || content().enemy(u.def).tier !== 'elite') continue;
    u.affixes = [...ids];
    for (const id of ids) {
      const a = content().affixes.get(id)!;
      for (const k of a.keywords ?? []) if (!u.extraKeywords.includes(k)) u.extraKeywords.push(k);
      if (a.onStart?.length) jobs.push({ effects: a.onStart, ctx: { side: 'enemy', source: u.uid, kind: 'unit', target: null, vars: {} } });
    }
  }
  return jobs;
}

import { placeUnit, scaleEnemyHp } from './core';
function placeUnitSilently(s: CombatState, row: 'front' | 'back', slot: number, id: string) {
  const size = row === 'front' ? FRONT : BACK;
  let sl = Math.min(slot, size - 1);
  if (s.sides.enemy[row][sl] != null) { const free = emptySlots(s, 'enemy', row); if (!free.length) return; sl = free[0]!; }
  placeUnit(s, 'enemy', row, sl, { def: id, origin: 'enemy' });
}

export interface ActResult { ok: boolean; error?: string; events: CEvent[] }

export function act(s: CombatState, a: PlayerAction): ActResult {
  s.events = [];
  const err = apply(s, a);
  if (err) return { ok: false, error: err, events: [] };
  if (s.active === 'player') s.acted = true;
  s.actions.push(a);
  run(s);
  const events = s.events;
  s.events = [];
  return { ok: true, events };
}

function apply(s: CombatState, a: PlayerAction): string | null {
  if (s.over) return 'combat over';
  if (s.pending) return answerDecision(s, a);
  if (s.tasks.length) return 'busy';
  switch (a.type) {
    case 'play': return playCard(s, a.card, a.target ?? null, a.slot ?? null);
    case 'sacrifice': return sacrifice(s, a.card);
    case 'attack': return declareAttack(s, a.attacker, a.target);
    case 'skill': return useSkill(s, a.skill, a.target ?? null);
    case 'potion': return usePotion(s, a.slot, a.target ?? null);
    case 'endTurn': s.tasks.push({ k: 'phase', name: 'playerTurnEnd' }); return null;
    default: return 'invalid action now';
  }
}

// ───────────── card play ─────────────

export interface PlayableInfo {
  uid: number;
  playable: boolean;
  reason?: 'cost' | 'target' | 'unplayable' | 'window' | 'slot';
  targets: number[] | null;
  slots?: { row: 'front' | 'back'; slot: number }[];
  payment?: number[];
}

export function playableInfo(s: CombatState, card: CardInst): PlayableInfo {
  const def = cardDef(card);
  const info: PlayableInfo = { uid: card.uid, playable: false, targets: null };
  if (def.unplayable) { info.reason = 'unplayable'; return info; }
  if (def.windowOnly) { info.reason = 'window'; return info; }
  const plan = planPayment(s, effectiveCost(s, card), card);
  info.payment = plan ?? undefined;
  info.targets = cardTargets(s, 'player', def);
  if (def.type === 'unit') {
    info.slots = [
      ...emptySlots(s, 'player', 'front').map((slot) => ({ row: 'front' as const, slot })),
      ...emptySlots(s, 'player', 'back').map((slot) => ({ row: 'back' as const, slot })),
    ];
    if (!info.slots.length) { info.reason = 'slot'; return info; }
  }
  if (!plan) { info.reason = 'cost'; return info; }
  if (info.targets && !info.targets.length) { info.reason = 'target'; return info; }
  info.playable = true;
  return info;
}

function playCard(s: CombatState, uid: number, target: number | null, slot: { row: 'front' | 'back'; slot: number } | null): string | null {
  const card = s.hand.find((c) => c.uid === uid);
  if (!card) return 'card not in hand';
  const info = playableInfo(s, card);
  if (!info.playable) return `unplayable: ${info.reason}`;
  if (info.targets && (target === null || !info.targets.includes(target))) return 'bad target';
  if (!info.targets) target = null;
  const def = cardDef(card);
  if (def.type === 'unit') {
    if (!slot) slot = info.slots![0]!;
    if (!info.slots!.some((x) => x.row === slot!.row && x.slot === slot!.slot)) return 'bad slot';
  }
  const need = effectiveCost(s, card);
  const plan = info.payment!;
  const x = need.x ? plan.length - need.c.length : 0;
  paySources(s, plan);
  s.nextCardCostMod = 0;
  s.hand.splice(s.hand.indexOf(card), 1);
  s.limbo.push(card);
  emit(s, { t: 'play', side: 'player', card, target });
  s.tasks.push({ k: 'chain', stage: 'window', links: [{ kind: 'card', side: 'player', card, target, slot, x }], passes: 0, origin: 'player' });
  return null;
}

export function sacrificesAllowed(s: CombatState) {
  return 1 + sumModsSide(s, 'sacrifices');
}
import { sumMods } from './board';
function sumModsSide(s: CombatState, stat: Parameters<typeof sumMods>[1]) { return sumMods(s, stat, 'player'); }

export function canSacrifice(s: CombatState): boolean {
  return s.phase === 'main' && s.sacrificesThisTurn < sacrificesAllowed(s);
}

function sacrifice(s: CombatState, uid: number): string | null {
  const card = s.hand.find((c) => c.uid === uid);
  if (!card) return 'card not in hand';
  if (s.sacrificesThisTurn >= sacrificesAllowed(s)) return 'already sacrificed this turn';
  const def = cardDef(card);
  s.sacrificesThisTurn += 1;
  s.hand.splice(s.hand.indexOf(card), 1);
  s.sacrificed.push(card);
  const color: Color = def.type === 'status' || def.type === 'curse' ? 'N' : def.faction;
  const gained = addSource(s, color, true);
  emit(s, { t: 'sacrifice', card, color, gained });
  s.stats.sacrifices = (s.stats.sacrifices ?? 0) + 1;
  fire(s, 'cardSacrificed', { side: 'player', card });
  if (def.onSacrifice) pushFx(s, def.onSacrifice, cardCtx(s, 'player', card, null));
  return null;
}

// ───────────── attacks ─────────────

export function attackOptions(s: CombatState): { attacker: number; targets: number[] }[] {
  if (s.phase !== 'main') return [];
  const out: { attacker: number; targets: number[] }[] = [];
  for (const u of unitsOf(s, 'player', true)) {
    if (!canAttack(s, u)) continue;
    const t = attackTargets(s, u).map((x) => x.uid);
    if (t.length) out.push({ attacker: u.uid, targets: t });
  }
  return out;
}

function declareAttack(s: CombatState, attacker: number, target: number): string | null {
  const a = unit(s, attacker);
  if (!alive(a) || a.side !== 'player') return 'bad attacker';
  if (!canAttack(s, a)) return 'cannot attack';
  if (!attackTargets(s, a).some((t) => t.uid === target)) return 'illegal target';
  s.tasks.push({ k: 'chain', stage: 'window', links: [{ kind: 'attack', attacker, target }], passes: 0, origin: 'player' });
  return null;
}

// ───────────── skills / potions ─────────────

export function skillUsable(s: CombatState, i: number): { ok: boolean; targets: number[] | null } {
  const sk = s.skills[i];
  const def = sk ? skillDef(s, sk) : undefined;
  if (!sk || !def) return { ok: false, targets: null };
  if (def.type === 'passive' || def.type === 'awaken') return { ok: false, targets: null };
  if (def.type === 'active' && sk.used) return { ok: false, targets: null };
  if (def.type === 'limited' && sk.usedCombat) return { ok: false, targets: null };
  if (def.cost) {
    const plan = planPayment(s, { g: def.cost.g === 'X' ? 0 : def.cost.g, c: def.cost.c ?? [], x: false });
    if (!plan) return { ok: false, targets: null };
  }
  const targets = def.target && def.target !== 'none' ? cardTargets(s, 'player', { ...fakeCard, target: def.target }) : null;
  if (targets && !targets.length) return { ok: false, targets };
  return { ok: true, targets };
}

const fakeCard = { id: 'x', name: 'x', faction: 'N', type: 'tactic', rarity: 'special', cost: { g: 0 }, text: '', art: { subject: 'none....' } } as const;

function useSkill(s: CombatState, i: number, target: number | null): string | null {
  const u = skillUsable(s, i);
  if (!u.ok) return 'skill unavailable';
  if (u.targets && (target === null || !u.targets.includes(target))) return 'bad target';
  const sk = s.skills[i]!;
  const def = skillDef(s, sk)!;
  if (def.cost) {
    const plan = planPayment(s, { g: def.cost.g === 'X' ? 0 : def.cost.g, c: def.cost.c ?? [], x: false })!;
    paySources(s, plan);
  }
  sk.used = true;
  if (def.type === 'limited') sk.usedCombat = true;
  emit(s, { t: 'skill', index: i });
  s.tasks.push({ k: 'chain', stage: 'window', links: [{ kind: 'skill', side: 'player', skill: i, target }], passes: 0, origin: 'player' });
  return null;
}

export function potionTargets(s: CombatState, slot: number): number[] | null {
  const id = s.potions[slot];
  if (!id) return null;
  const def = content().potions.get(id);
  if (!def || def.target === 'none') return null;
  return cardTargets(s, 'player', { ...fakeCard, target: def.target });
}

function usePotion(s: CombatState, slot: number, target: number | null): string | null {
  const id = s.potions[slot];
  if (!id) return 'empty slot';
  const def = content().potions.get(id);
  if (!def) return 'unknown potion';
  const targets = potionTargets(s, slot);
  if (targets && (target === null || !targets.includes(target))) return 'bad target';
  s.potions[slot] = null;
  emit(s, { t: 'potion', slot, id });
  pushFx(s, def.effects, { side: 'player', source: s.sides.player.commander, kind: 'potion', target, vars: {} });
  return null;
}

// ───────────── misc queries ─────────────

/** true when the player has nothing meaningful left to do (drives the end-turn button state) */
export function noActionsLeft(s: CombatState): boolean {
  if (s.phase !== 'main') return false;
  if (s.hand.some((c) => playableInfo(s, c).playable)) return false;
  if (attackOptions(s).length) return false;
  if (s.skills.some((_, i) => skillUsable(s, i).ok)) return false;
  return true;
}

export function playerCommander(s: CombatState) { return commanderOf(s, 'player')!; }
export { emberCap, isResponse, reach, other };
export type { Side };
