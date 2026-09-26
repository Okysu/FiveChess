/**
 * Trigger audit: every trigger in the real content (equipment, units, fields, in-hand cards, relics,
 * commander / lieutenant skills incl. awaken, enemy passives) is installed in a minimal sandbox combat
 * on the side(s) the DSL allows, its `on` condition is forced through the real engine, and we assert
 *   1. the trigger fired  — a probe effect (a test-registered script) is prepended to the trigger's effects, and
 *   2. its effects did something observable — the same deterministic scenario is replayed with the
 *      trigger's real effects removed (probe only) and the final state / event log must differ.
 * Scenarios that cannot be forced (e.g. an enemy-side trigger on a player-only event) are listed with a
 * reason at the end instead of being skipped silently.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { loadContent } from '../scripts/load-content';
import { act, createCombat } from '../src/engine/combat/api';
import { autoAnswer } from '../src/engine/combat/autoplay';
import { alive, canAttack, commanderOf, unit, unitsOf } from '../src/engine/combat/board';
import { cardDef, equipCard, fire, isResponse, newTs, newUid, pushFx, registerScript, run } from '../src/engine/combat/core';
import { rollIntent } from '../src/engine/combat/intents';
import type { AnyEffect, CEvent, CombatState, Ctx, PlayerAction, Side, Unit } from '../src/engine/combat/state';
import { other } from '../src/engine/combat/state';
import type { Effect, Suit, Trigger, TriggerOn } from '../src/engine/defs';
import { SUITS } from '../src/engine/defs';

const c = loadContent();
const fate = SUITS.flatMap((suit) => Array.from({ length: 13 }, (_, i) => ({ suit, rank: i + 1 })));
/** probe effect prepended to the trigger under test; counts resolutions on the state (side-agnostic) */
const probeHits = new WeakMap<CombatState, number>();
registerScript('__test_probe', (s) => { probeHits.set(s, (probeHits.get(s) ?? 0) + 1); });

// ───────────── case enumeration ─────────────

type Kind = 'equip' | 'unit' | 'field' | 'inHand' | 'relic' | 'skill' | 'awaken' | 'awakened' | 'enemy';
interface Case {
  kind: Kind;
  id: string; // card / relic / enemy id, or commander|lieutenant id for skills
  up: boolean;
  side: Side; // owner side
  trig: Trigger; // the trigger object inside content (mutated temporarily for the probe)
  /** for skills: which skill slot and whether it is the lieutenant */
  skill?: { lieutenant: boolean; skillId: string };
  label: string;
}

const cases: Case[] = [];
const seen = new Set<Trigger>();
function addCase(k: Omit<Case, 'label'>, idx: number) {
  cases.push({ ...k, label: `${k.kind}:${k.id}${k.up ? '+' : ''}@${k.side}#${idx} ${k.trig.on}/${k.trig.who ?? '-'}` });
}

for (const d of c.cards.values()) {
  for (const up of d.upgrade ? [false, true] : [false]) {
    const def = c.card(d.id, up);
    const push = (kind: Kind, trigs: Trigger[] | undefined, sides: Side[]) => (trigs ?? []).forEach((t, i) => {
      // identical trigger objects shared between base / upgraded versions are tested once per side
      const key = t;
      if (up && seen.has(key)) return;
      seen.add(key);
      for (const side of sides) addCase({ kind, id: d.id, up, side, trig: t }, i);
    });
    push('equip', def.equip?.triggers, ['player', 'enemy']);
    push('unit', def.unit?.triggers, ['player', 'enemy']);
    push('field', def.field?.triggers, ['player', 'enemy']);
    push('inHand', def.inHand, ['player']);
  }
}
for (const r of c.relics.values()) (r.triggers ?? []).forEach((t, i) => addCase({ kind: 'relic', id: r.id, up: false, side: 'player', trig: t }, i));
for (const cm of c.commanders.values()) {
  for (const sk of cm.skills) {
    (sk.triggers ?? []).forEach((t, i) => addCase({ kind: 'skill', id: cm.id, up: false, side: 'player', trig: t, skill: { lieutenant: false, skillId: sk.id } }, i));
    if (sk.awaken) {
      addCase({ kind: 'awaken', id: cm.id, up: false, side: 'player', trig: { on: sk.awaken.on, who: sk.awaken.who, if: sk.awaken.if, effects: sk.awaken.effects ?? [] }, skill: { lieutenant: false, skillId: sk.id } }, 0);
      ((sk.awaken.becomes as { triggers?: Trigger[] } | undefined)?.triggers ?? []).forEach((t, i) => addCase({ kind: 'awakened', id: cm.id, up: false, side: 'player', trig: t, skill: { lieutenant: false, skillId: sk.id } }, i));
    }
  }
}
for (const l of c.lieutenants.values()) {
  const sk = l.skill;
  (sk.triggers ?? []).forEach((t, i) => addCase({ kind: 'skill', id: l.id, up: false, side: 'player', trig: t, skill: { lieutenant: true, skillId: sk.id } }, i));
  if (sk.awaken) {
    addCase({ kind: 'awaken', id: l.id, up: false, side: 'player', trig: { on: sk.awaken.on, who: sk.awaken.who, if: sk.awaken.if, effects: sk.awaken.effects ?? [] }, skill: { lieutenant: true, skillId: sk.id } }, 0);
    ((sk.awaken.becomes as { triggers?: Trigger[] } | undefined)?.triggers ?? []).forEach((t, i) => addCase({ kind: 'awakened', id: l.id, up: false, side: 'player', trig: t, skill: { lieutenant: true, skillId: sk.id } }, i));
  }
}
for (const e of c.enemies.values()) (e.passives ?? []).forEach((t, i) => addCase({ kind: 'enemy', id: e.id, up: false, side: 'enemy', trig: t }, i));

// ───────────── scenario plumbing ─────────────

const SELF_DEFAULT: TriggerOn[] = ['damaged', 'attacked', 'death', 'enter', 'dealtDamage', 'attacking', 'healed', 'armorGained', 'armorBroken', 'statusApplied'];
const ANY_DEFAULT: TriggerOn[] = ['judged', 'combatStart', 'combatEnd', 'rejudged'];
const ENEMY_DEFAULT: TriggerOn[] = ['opponentTurnStart', 'opponentTurnEnd', 'actionDeclared'];
function whoOf(t: Trigger) {
  if (t.who) return t.who;
  if (SELF_DEFAULT.includes(t.on)) return 'self';
  if (ANY_DEFAULT.includes(t.on)) return 'any';
  if (ENEMY_DEFAULT.includes(t.on)) return 'enemy';
  return 'friendly';
}

/** events that only the player side can produce */
const PLAYER_ONLY: TriggerOn[] = ['cardSacrificed', 'cardDrawn', 'cardDiscarded', 'cardExhausted', 'cardCreated', 'responsePlayed', 'sourceGained', 'shuffled'];

interface Variant { rich?: boolean; useUnit?: boolean; targetUnit?: boolean; delayCard?: boolean; combo?: number; big?: boolean }
const VARIANTS: Variant[] = [
  {}, { rich: true }, { rich: true, useUnit: true }, { rich: true, targetUnit: true }, { rich: true, useUnit: true, targetUnit: true },
  { rich: true, delayCard: true }, { rich: true, combo: 3 }, { rich: true, combo: 4 }, { rich: true, combo: 5 }, { rich: true, big: true }, { useUnit: true }, { targetUnit: true },
];

interface Sc { s: CombatState; log: string[]; owner: Unit | null }

/** a low-noise commander: no skill modifiers (e.g. armorKeep), no awaken, and a trigger that stays quiet in these scenarios */
const quiet = (id: string) => c.commanders.get(id);
const baseCmd = quiet('p_yetan') ?? [...c.commanders.values()].find((cm) => cm.skills.every((sk) => !sk.awaken && !sk.modifiers?.length)) ?? [...c.commanders.values()][0]!;
const playCardId = 'n_glimpse';
const delayCardId = [...c.cards.values()].find((d) => d.type === 'delay' && d.delay?.on === 'enemy' && d.faction !== 'N' && !d.id.startsWith('ec_'))!.id;
const responseCardId = 'n_brace';
const tokenId = 'tk_g_sprout';

function flush(sc: Sc) {
  for (const e of sc.s.events) sc.log.push(JSON.stringify(e));
  sc.s.events = [];
}
function doAct(sc: Sc, a: PlayerAction) {
  flush(sc);
  const r = act(sc.s, a);
  for (const e of r.events) sc.log.push(JSON.stringify(e));
  settle(sc);
  return r;
}
function settle(sc: Sc) {
  run(sc.s);
  for (let i = 0; i < 40 && sc.s.pending && !sc.s.over; i++) {
    flush(sc);
    const r = act(sc.s, autoAnswer(sc.s));
    for (const e of r.events) sc.log.push(JSON.stringify(e));
    if (!r.ok) break;
  }
  flush(sc);
}
function fx(sc: Sc, side: Side, effects: (Effect | AnyEffect)[], extra: Partial<Ctx> = {}) {
  const ctx: Ctx = { side, source: sc.s.sides[side].commander, kind: 'system', target: null, vars: {}, ...extra };
  pushFx(sc.s, effects as AnyEffect[], ctx);
  settle(sc);
}

function makeEnemyCommander(s: CombatState, defId: string): Unit {
  const def = c.enemy(defId);
  const hp = Math.max(300, def.hp[0]);
  const boss: Unit = {
    uid: newUid(s), side: 'enemy', kind: 'commander', def: def.id, origin: 'enemy', up: false, name: def.name, row: 'cmd', slot: 0,
    baseAtk: def.atk, baseMaxHp: hp, hp, armor: 0, atkBuff: 0, hpBuff: 0, tempAtk: 0, ward: 0, thorns: 0,
    growth: 0, statuses: {}, extraKeywords: [], silenced: false, stealth: false, ts: newTs(s), enteredTurn: 0, attacks: 0,
    stunImmune: 0, delays: [], counter: 0, essential: true, ai: { history: [], fired: [], cycle: 0 }, phase: 0,
  };
  s.units[boss.uid] = boss;
  s.sides.enemy.commander = boss.uid;
  rollIntent(s, boss);
  return boss;
}

function spawn(sc: Sc, side: Side, hp?: number, row?: 'front' | 'back'): Unit {
  const before = new Set(unitsOf(sc.s, side).map((u) => u.uid));
  fx(sc, side, [{ op: 'summon', unit: tokenId, ...(hp ? { hp } : {}), ...(row ? { row } : {}) }]);
  const u = unitsOf(sc.s, side).find((x) => !before.has(x.uid));
  if (!u) throw new Error('no room to summon');
  return u;
}

function kill(sc: Sc, u: Unit, by: Side = other(u.side)) {
  if (u.kind === 'commander') fx(sc, by, [{ op: 'loseHp', amount: 99999, target: 'target' }], { target: u.uid });
  else fx(sc, by, [{ op: 'kill', target: 'target' }], { target: u.uid });
}

function topFate(s: CombatState, suit: Suit, rank = 13) {
  s.fate.deck.push({ suit, rank, id: newUid(s) });
  s.fate.known = 0;
}

function suitFor(t: Trigger): Suit {
  if (!t.suit) return 'sun';
  if (t.suit === 'yang') return 'sun';
  if (t.suit === 'yin') return 'moon';
  return t.suit;
}

function snapshot(s: CombatState): string {
  const units = Object.values(s.units).map((u) => [u.uid, u.def, u.side, u.hp, u.armor, u.ward, u.atkBuff, u.hpBuff, u.tempAtk, u.statuses, u.extraKeywords, u.thorns, u.growth, u.counter, !!u.removed, !!u.dead, u.row, u.slot, u.delays, u.silenced, u.stealth]);
  return JSON.stringify({
    units, sides: s.sides, hand: s.hand, draw: s.draw, discard: s.discard, exhaust: s.exhaust, sources: s.sources, fate: s.fate,
    gold: s.goldGained, relics: s.relics, skills: s.skills, next: s.nextCardCostMod, ember: s.emberCap, over: s.over, sac: s.sacrificed,
  });
}

/** builds the combat, installs the trigger owner and applies the variant's preconditions */
function build(k: Case, v: Variant, seed: string): Sc | string {
  const cmd = k.kind === 'skill' || k.kind === 'awaken' || k.kind === 'awakened'
    ? (k.skill!.lieutenant ? baseCmd : c.commander(k.id)) : baseCmd;
  const s = createCombat({
    commander: cmd.id, hp: 250, maxHp: 300, deck: cmd.deck.map((id) => ({ id, up: false })),
    relics: k.kind === 'relic' ? [{ id: k.id, counter: 0 }] : [],
    lieutenant: k.skill?.lieutenant ? k.id : undefined,
    potions: [null, null, null], fateDeck: fate, encounter: 'sandbox', ascension: 0, seed,
  });
  const sc: Sc = { s, log: [], owner: null };
  flush(sc);
  const owner = k.side;
  const bossDef = k.kind === 'enemy' && c.enemy(k.id).row === 'commander' ? k.id : 'sandbox_dummy';
  makeEnemyCommander(s, bossDef);
  s.sources = (['R', 'B', 'G', 'Y', 'P', 'N'] as const).map((color) => ({ color, ready: true }));
  const on = k.trig.on;
  const who = whoOf(k.trig);
  const selfInstall = (on === 'enter' || on === 'unitSummoned') && who === 'self';
  switch (k.kind) {
    case 'equip': {
      const def = c.card(k.id, k.up);
      if (owner === 'enemy' && def.equip?.slot === 'weapon') {
        // enemy commanders attack with their own atk; a weapon is legal but only its triggers matter here
      }
      equipCard(s, owner, { uid: newUid(s), id: k.id, up: k.up });
      settle(sc);
      sc.owner = commanderOf(s, owner)!;
      break;
    }
    case 'field': {
      const def = c.card(k.id, k.up);
      s.sides[owner].field = { uid: newUid(s), card: k.id, up: k.up, turns: def.field?.duration ?? null, ts: newTs(s) };
      sc.owner = commanderOf(s, owner)!;
      break;
    }
    case 'unit': {
      if (!selfInstall) {
        const before = new Set(unitsOf(s, owner).map((u) => u.uid));
        fx(sc, owner, [{ op: 'summon', unit: k.id, row: 'back' }]);
        const u = unitsOf(s, owner).find((x) => !before.has(x.uid) && x.def === k.id);
        if (!u) return 'could not place unit';
        u.up = k.up;
        sc.owner = u;
      }
      break;
    }
    case 'enemy': {
      if (bossDef === k.id) sc.owner = commanderOf(s, 'enemy')!;
      else if (!selfInstall) {
        const before = new Set(unitsOf(s, 'enemy').map((u) => u.uid));
        fx(sc, 'enemy', [{ op: 'summon', unit: k.id }]);
        const u = unitsOf(s, 'enemy').find((x) => !before.has(x.uid) && x.def === k.id);
        if (!u) return 'could not place enemy';
        sc.owner = u;
      }
      break;
    }
    case 'inHand': {
      const card = { uid: newUid(s), id: k.id, up: k.up };
      // "when drawn" curses: put the card on top of the draw pile so the forcing draw draws it
      if (on === 'cardDrawn') s.draw.push(card); else s.hand.push(card);
      sc.owner = commanderOf(s, 'player')!;
      break;
    }
    case 'awakened': {
      const i = s.skills.findIndex((x) => x.id === k.skill!.skillId);
      s.skills[i]!.awakened = true;
      sc.owner = commanderOf(s, 'player')!;
      break;
    }
    default: sc.owner = commanderOf(s, 'player')!;
  }
  // preconditions for common `if` clauses
  if (v.rich) {
    s.cardsPlayedThisTurn = v.combo ?? 2;
    for (let i = 0; i < 10; i++) s.sacrificed.push({ uid: newUid(s), id: playCardId, up: false });
    s.stats.responses = 10;
    s.stats.judgesThisTurn = { sun: 1, moon: 1, thunder: 1 };
    const oc = commanderOf(s, owner)!;
    oc.hp = Math.floor(oc.baseMaxHp * 0.4);
    // sturdy units on both sides (one taunts), so "friendly units ≥ 3", "highest-atk enemy", "taunt allies"… hold
    for (const side of ['player', 'enemy'] as Side[]) {
      for (let i = 0; i < 3; i++) if (unitsOf(s, side).length < 6) spawn(sc, side, 60);
      const t = unitsOf(s, side).find((u) => u.def === tokenId);
      if (t) t.extraKeywords.push('taunt');
    }
    // statuses / delays / weapons that "for each enemy with X" or "your weapon" effects look at
    for (const u of unitsOf(s, other(owner), true)) { u.statuses.poison = 3; u.statuses.burn = 2; }
    for (const u of unitsOf(s, other(owner), true)) u.delays.push({ uid: newUid(s), card: delayCardId, up: false, turns: 9, owner });
    if (!s.sides.player.equip.weapon) equipCard(s, 'player', { uid: newUid(s), id: 'r_bronze_saber', up: false });
    if (!s.sides.enemy.equip.weapon) equipCard(s, 'enemy', { uid: newUid(s), id: 'ec_a_rust_halberd', up: false });
    settle(sc);
    if (sc.owner) sc.owner.counter = 3;
    for (const r of s.relics) r.counter = 3;
  }
  // enemy hand/deck so enemy-side "draw" has something to draw
  s.sides.enemy.deck = Array.from({ length: 5 }, () => ({ uid: newUid(s), id: 'ec_a_shield_wall', up: false }));
  if (v.combo !== undefined) s.cardsPlayedThisTurn = v.combo;
  // damaged units / commanders so heals are visible
  commanderOf(s, 'enemy')!.hp -= 20;
  // ward would swallow the single forcing hit (and with it every damage trigger)
  for (const u of Object.values(s.units)) u.ward = 0;
  flush(sc);
  return sc;
}

type ForceResult = { fired: number; note?: string };

/** forces the trigger condition; returns the number of probe hits during the forcing step */
function force(sc: Sc, k: Case, v: Variant): ForceResult | string {
  const s = sc.s;
  const t = k.trig;
  const on = t.on;
  const who = whoOf(t);
  const O = k.side;
  const E: Side = who === 'enemy' ? other(O) : O;
  // relics / skills are live from createCombat on: combat start and the first turn start count as natural fires
  const creationFired = k.kind === 'relic' || k.kind === 'skill' || k.kind === 'awaken' || k.kind === 'awakened';
  const g0 = creationFired ? 0 : probeHits.get(s) ?? 0;
  if (PLAYER_ONLY.includes(on) && E !== 'player') return `${on} is a player-only event but the trigger listens on the enemy side`;
  if (on === 'cardPlayed' && E === 'enemy' && !s.sides.enemy.commander) return 'enemy cannot play cards';
  // subject: the unit the event is about
  const subjectOf = (): Unit => {
    if (who === 'self') {
      if (sc.owner) return sc.owner;
      return commanderOf(s, O)!;
    }
    if (v.useUnit) return unitsOf(s, E).find((u) => u.uid !== sc.owner?.uid) ?? spawn(sc, E);
    return commanderOf(s, E)!;
  };
  const oppOf = (subject: Unit): Unit => {
    const os = other(subject.side);
    if (v.targetUnit) return unitsOf(s, os).find((u) => u.uid !== sc.owner?.uid) ?? spawn(sc, os);
    return commanderOf(s, os)!;
  };
  switch (on) {
    case 'combatStart':
      if (!creationFired || k.kind === 'awakened') { fire(s, 'combatStart', { side: 'player' }); settle(sc); }
      break;
    case 'combatEnd': kill(sc, commanderOf(s, 'enemy')!, 'player'); break;
    case 'turnStart': case 'turnEnd': case 'opponentTurnStart': case 'opponentTurnEnd': case 'actionDeclared': {
      // triggers gated on a turn number (e.g. 崩山石 on turn 3) need that many rounds
      const rounds = JSON.stringify(k.trig.if ?? {}).includes('"turn"') ? 4 : 1;
      for (let i = 0; i < rounds && !s.over; i++) doAct(sc, { type: 'endTurn' });
      break;
    }
    case 'enter': case 'unitSummoned': {
      if (who === 'self') {
        const side = O;
        const id = k.id;
        const before = new Set(unitsOf(s, side).map((u) => u.uid));
        fx(sc, side, [{ op: 'summon', unit: id }]);
        sc.owner = unitsOf(s, side).find((x) => !before.has(x.uid)) ?? null;
      } else spawn(sc, E);
      break;
    }
    case 'death': {
      if (who === 'self') { if (!sc.owner) return 'no owner unit'; kill(sc, sc.owner); } else kill(sc, spawn(sc, E));
      break;
    }
    case 'unitDied': kill(sc, spawn(sc, E)); break;
    case 'cardPlayed': {
      if (E === 'player') {
        const id = v.delayCard ? delayCardId : playCardId;
        const card = { uid: newUid(s), id, up: false };
        s.hand.push(card);
        const def = cardDef(card);
        const target = def.type === 'delay' ? commanderOf(s, 'enemy')!.uid : null;
        const r = doAct(sc, { type: 'play', card: card.uid, target });
        if (!r.ok) return `could not play ${id}: ${r.error}`;
      } else {
        const card = { uid: newUid(s), id: 'ec_a_shield_wall', up: false };
        s.limbo.push(card);
        s.tasks.push({ k: 'chain', stage: 'window', links: [{ kind: 'card', side: 'enemy', card, target: null, slot: null, x: 0 }], passes: 0, origin: 'enemy' });
        settle(sc);
      }
      break;
    }
    case 'cardSacrificed': {
      const card = { uid: newUid(s), id: playCardId, up: false };
      s.hand.push(card);
      s.sacrificesThisTurn = 0;
      const r = doAct(sc, { type: 'sacrifice', card: card.uid });
      if (!r.ok) return `sacrifice failed: ${r.error}`;
      break;
    }
    case 'cardDrawn': fx(sc, 'player', [{ op: 'draw', n: 1 }]); break;
    case 'cardDiscarded': s.hand.push({ uid: newUid(s), id: playCardId, up: false }); fx(sc, 'player', [{ op: 'discard', n: 1, mode: 'random' }]); break;
    case 'cardExhausted': s.hand.push({ uid: newUid(s), id: playCardId, up: false }); fx(sc, 'player', [{ op: 'exhaustCards', n: 1, mode: 'random' }]); break;
    case 'cardCreated': fx(sc, 'player', [{ op: 'create', card: playCardId, to: 'hand' }]); break;
    case 'shuffled': s.discard.push(...s.draw.splice(0)); fx(sc, 'player', [{ op: 'draw', n: 1 }]); break;
    case 'sourceGained': s.sources = s.sources.slice(0, 3); fx(sc, 'player', [{ op: 'gainSource', n: 1, color: 'N' }]); break;
    case 'responsePlayed': {
      const card = { uid: newUid(s), id: responseCardId, up: false };
      s.hand = s.hand.filter((x) => !isResponse(cardDef(x)));
      s.hand.push(card);
      s.emberCap = 10;
      s.autoSkipResponse = false;
      flush(sc);
      const r = act(s, { type: 'endTurn' });
      for (const e of r.events) sc.log.push(JSON.stringify(e));
      let responded = false;
      for (let i = 0; i < 20 && s.pending && !s.over; i++) {
        let a: PlayerAction = autoAnswer(s);
        if (s.pending.kind === 'response' && !responded && s.pending.options.includes(card.uid)) { a = { type: 'respond', card: card.uid }; responded = true; }
        else if (s.pending.kind === 'response') a = { type: 'pass' };
        flush(sc);
        const rr = act(s, a);
        for (const e of rr.events) sc.log.push(JSON.stringify(e));
      }
      flush(sc);
      if (!responded) return 'no response window opened';
      break;
    }
    case 'damaged': { const sub = subjectOf(); fx(sc, other(sub.side), [{ op: 'damage', amount: v.big ? 25 : 4, target: 'target' }], { target: sub.uid, source: oppOf(sub).uid }); break; }
    case 'dealtDamage': { const sub = subjectOf(); fx(sc, sub.side, [{ op: 'damage', amount: v.big ? 25 : 3, target: 'target' }], { source: sub.uid, target: oppOf(sub).uid }); break; }
    case 'attacking': { const sub = subjectOf(); fx(sc, sub.side, [{ op: '__attack', attacker: sub.uid, target: oppOf(sub).uid }]); break; }
    case 'attacked': { const sub = subjectOf(); const opp = oppOf(sub); fx(sc, opp.side, [{ op: '__attack', attacker: opp.uid, target: sub.uid }]); break; }
    case 'healed': { const sub = subjectOf(); sub.hp = Math.max(1, sub.hp - 10); fx(sc, sub.side, [{ op: 'heal', amount: 5, target: 'target' }], { target: sub.uid }); break; }
    case 'armorGained': { const sub = subjectOf(); fx(sc, sub.side, [{ op: 'armor', amount: 3, target: 'target' }], { target: sub.uid }); break; }
    case 'armorBroken': {
      const sub = subjectOf();
      fx(sc, sub.side, [{ op: 'armor', amount: 3, target: 'target' }], { target: sub.uid });
      fx(sc, other(sub.side), [{ op: 'damage', amount: 10, target: 'target' }], { target: sub.uid, source: oppOf(sub).uid });
      break;
    }
    case 'statusApplied': { const sub = subjectOf(); fx(sc, other(sub.side), [{ op: 'status', status: t.status ?? 'might', amount: 1, target: 'target' }], { target: sub.uid }); break; }
    case 'judged': {
      topFate(s, suitFor(t));
      s.fate.signs = [];
      s.sides.enemy.signs = [];
      fx(sc, E, [{ op: 'judge', branches: {} }]);
      break;
    }
    case 'rejudged': {
      if (E === 'player') {
        s.fate.signs = [{ suit: 'sun', rank: 12, id: newUid(s) }];
        s.sides.enemy.signs = [];
        topFate(s, 'moon', 3);
        fx(sc, 'player', [{ op: 'judge', branches: {} }]);
      } else {
        s.fate.signs = [];
        s.sides.enemy.signs = [{ suit: 'moon', rank: 2, id: newUid(s) }];
        topFate(s, 'sun', 12);
        fx(sc, 'player', [{ op: 'judge', branches: {} }]);
      }
      break;
    }
    case 'equipped': fx(sc, E, [{ op: 'equip', card: E === 'player' ? 'r_bronze_saber' : 'ec_a_rust_halberd' }]); break;
    default: return `no forcing recipe for ${on}`;
  }
  return { fired: (probeHits.get(s) ?? 0) - g0 };
}

interface Outcome { fired: number; observable: boolean; skip?: string; variant?: number; error?: string }

function withEffects<T>(k: Case, effects: Effect[], fn: () => T): T {
  const probe: Effect = { op: 'script', id: '__test_probe' };
  if (k.kind === 'awaken') {
    const def = (k.skill!.lieutenant ? c.lieutenants.get(k.id)!.skill : c.commander(k.id).skills.find((x) => x.id === k.skill!.skillId)!).awaken!;
    const orig = def.effects;
    def.effects = [probe, ...effects];
    try { return fn(); } finally { def.effects = orig; }
  }
  const orig = k.trig.effects;
  k.trig.effects = [probe, ...effects];
  try { return fn(); } finally { k.trig.effects = orig; }
}

function scenario(k: Case, v: Variant, vi: number, real: boolean): { fired: number; snap: string; log: string; skip?: string } {
  const effects = real ? (k.kind === 'awaken' ? (k.trig.effects ?? []) : k.trig.effects) : [];
  return withEffects(k, effects, () => {
    const sc = build(k, v, `trig:${k.label}:${vi}`);
    if (typeof sc === 'string') return { fired: 0, snap: '', log: '', skip: sc };
    const r = force(sc, k, v);
    if (typeof r === 'string') return { fired: 0, snap: '', log: '', skip: r };
    flush(sc);
    return { fired: r.fired, snap: snapshot(sc.s), log: sc.log.join('\n') };
  });
}

function evaluateCase(k: Case): Outcome {
  let best: Outcome = { fired: 0, observable: false };
  for (let vi = 0; vi < VARIANTS.length; vi++) {
    const v = VARIANTS[vi]!;
    const a = scenario(k, v, vi, true);
    if (a.skip) { if (vi === 0) return { fired: 0, observable: false, skip: a.skip }; continue; }
    if (a.fired === 0) continue;
    const b = scenario(k, v, vi, false);
    const observable = a.snap !== b.snap || a.log !== b.log;
    best = { fired: a.fired, observable, variant: vi };
    if (observable) return best;
  }
  return best;
}

// ───────────── tests ─────────────

const untestable: string[] = [];
const noEffect: string[] = [];

describe('every trigger fires and has an observable effect', () => {
  const byKind = new Map<Kind, Case[]>();
  for (const k of cases) (byKind.get(k.kind) ?? byKind.set(k.kind, []).get(k.kind)!).push(k);
  for (const [kind, list] of byKind) {
    describe(kind, () => {
      for (const k of list) {
        it(k.label, () => {
          const o = evaluateCase(k);
          if (o.skip) { untestable.push(`${k.label}: ${o.skip}`); return; }
          expect(o.fired, `${k.label} never fired`).toBeGreaterThan(0);
          if (!o.observable) noEffect.push(`${k.label}: fired but no observable change`);
          expect(o.observable, `${k.label} fired but its effects changed nothing`).toBe(true);
        });
      }
    });
  }
  it('covers every trigger category', () => {
    const counts: Record<string, number> = {};
    for (const k of cases) counts[`${k.kind}@${k.side}`] = (counts[`${k.kind}@${k.side}`] ?? 0) + 1;
    console.log('[triggers] cases per category:', counts);
    expect(cases.length).toBeGreaterThan(100);
  });
});

afterAll(() => {
  if (untestable.length) console.log(`[triggers] not verifiable (${untestable.length}):\n  ` + untestable.join('\n  '));
  if (noEffect.length) console.log(`[triggers] fired without observable effect (${noEffect.length}):\n  ` + noEffect.join('\n  '));
});

// ───────────── targeted checks ─────────────

function sandbox(seed: string, relics: string[] = []): Sc {
  const s = createCombat({
    commander: baseCmd.id, hp: 250, maxHp: 300, deck: baseCmd.deck.map((id) => ({ id, up: false })), relics: relics.map((id) => ({ id, counter: 0 })),
    potions: [null, null, null], fateDeck: fate, encounter: 'sandbox', ascension: 0, seed,
  });
  const sc: Sc = { s, log: [], owner: null };
  flush(sc);
  return sc;
}
const armorOf = (s: CombatState, side: Side) => commanderOf(s, side)!.armor;
const armorEvents = (log: string[], uid: number) => log.map((l) => JSON.parse(l) as CEvent).filter((e) => e.t === 'armor' && e.target === uid && e.amount > 0);

describe('心材坠 g_heartwood_pendant', () => {
  for (const up of [false, true]) {
    const gain = up ? 3 : 2;
    it(`player side${up ? '+' : ''}: friendly unit death → commander armor +${gain}; enemy death does not count`, () => {
      const sc = sandbox(`hw:p:${up}`);
      const s = sc.s;
      equipCard(s, 'player', { uid: newUid(s), id: 'g_heartwood_pendant', up });
      settle(sc);
      const a0 = armorOf(s, 'player');
      kill(sc, spawn(sc, 'player'));
      expect(armorOf(s, 'player')).toBe(a0 + gain);
      kill(sc, spawn(sc, 'enemy'));
      expect(armorOf(s, 'player')).toBe(a0 + gain);
    });
    it(`enemy side${up ? '+' : ''}: enemy unit death → enemy commander armor +${gain}; player death does not count`, () => {
      const sc = sandbox(`hw:e:${up}`);
      const s = sc.s;
      makeEnemyCommander(s, 'sandbox_dummy');
      equipCard(s, 'enemy', { uid: newUid(s), id: 'g_heartwood_pendant', up });
      settle(sc);
      kill(sc, spawn(sc, 'enemy'));
      expect(armorOf(s, 'enemy')).toBe(gain);
      expect(armorOf(s, 'player')).toBe(0);
      kill(sc, spawn(sc, 'player'));
      expect(armorOf(s, 'enemy')).toBe(gain);
    });
  }

  it('counts simultaneous deaths, retaliation, burn, poison and deaths during the enemy turn', () => {
    const sc = sandbox('hw:many');
    const s = sc.s;
    const pcu = commanderOf(s, 'player')!.uid;
    equipCard(s, 'player', { uid: newUid(s), id: 'g_heartwood_pendant', up: false });
    settle(sc);
    // two friendly units die at once
    const a = spawn(sc, 'player'), b = spawn(sc, 'player');
    fx(sc, 'enemy', [{ op: 'damage', amount: 50, target: 'enemyUnits' }]);
    expect(alive(a) || alive(b)).toBe(false);
    expect(armorOf(s, 'player')).toBe(4);
    // killed by retaliation while attacking a dummy
    const r = spawn(sc, 'player');
    r.hp = 1;
    const dummy = unitsOf(s, 'enemy')[0]!;
    fx(sc, 'player', [{ op: '__attack', attacker: r.uid, target: dummy.uid }]);
    expect(unit(s, r.uid)).toBeUndefined();
    expect(armorOf(s, 'player')).toBe(6);
    // burn ticks at the player's turn start (after armor expiry), poison at the player's turn end,
    // and the dummies' pokes during the enemy turn
    // a sturdy taunting guard soaks the dummies' pokes so the DoT victims (back row) die to their DoT
    spawn(sc, 'player', 60, 'front').extraKeywords.push('taunt');
    const burnt = spawn(sc, 'player', undefined, 'back');
    burnt.hp = 1;
    burnt.statuses.burn = 3;
    const poisoned = spawn(sc, 'player', undefined, 'back');
    poisoned.hp = 1;
    poisoned.statuses.poison = 3;
    sc.log = [];
    doAct(sc, { type: 'endTurn' });
    expect(unit(s, burnt.uid)).toBeUndefined();
    expect(unit(s, poisoned.uid)).toBeUndefined();
    // poison death at player's turn end +2, burn death at next player's turn start +2 (after armor expired)
    expect(armorEvents(sc.log, pcu).length).toBeGreaterThanOrEqual(2);
    expect(armorOf(s, 'player')).toBeGreaterThanOrEqual(2);
  });
});

describe('trigger timing', () => {
  it('combat-start armor survives into the first player turn (rl_start_shiyun)', () => {
    const sc = sandbox('t:shiyun', ['rl_start_shiyun']);
    expect(sc.s.turn).toBe(1);
    expect(armorOf(sc.s, 'player')).toBeGreaterThanOrEqual(3);
  });

  it('turn-end armor (b_tortoise_mount) is still up during the enemy turn', () => {
    const sc = sandbox('t:tortoise');
    const s = sc.s;
    equipCard(s, 'player', { uid: newUid(s), id: 'b_tortoise_mount', up: false });
    settle(sc);
    const pc = commanderOf(s, 'player')!;
    const hp0 = pc.hp;
    doAct(sc, { type: 'endTurn' });
    const hits = sc.log.map((l) => JSON.parse(l) as CEvent).filter((e) => e.t === 'damage' && e.target === pc.uid);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((e) => e.t === 'damage' && e.armorLoss > 0)).toBe(true);
    expect(pc.hp).toBeGreaterThanOrEqual(hp0 - 3);
  });

  it('enemy turn-start armor (ec_a_coral_armor) lasts through the player turn', () => {
    const sc = sandbox('t:coral');
    const s = sc.s;
    makeEnemyCommander(s, 'sandbox_dummy');
    equipCard(s, 'enemy', { uid: newUid(s), id: 'ec_a_coral_armor', up: false });
    settle(sc);
    doAct(sc, { type: 'endTurn' });
    expect(s.active).toBe('player');
    expect(armorOf(s, 'enemy')).toBeGreaterThan(0);
  });

  it('delays tick on the afflicted side\'s turn start; statuses tick on their bearer\'s turn', () => {
    const sc = sandbox('t:delay');
    const s = sc.s;
    const dummy = unitsOf(s, 'enemy')[0]!;
    s.sources = (['R', 'B', 'G', 'Y', 'P', 'N'] as const).map((color) => ({ color, ready: true }));
    s.hand.push({ uid: 777001, id: delayCardId, up: false });
    const turns = c.card(delayCardId).delay!.turns;
    expect(doAct(sc, { type: 'play', card: 777001, target: dummy.uid }).ok).toBe(true);
    expect(dummy.delays.length).toBe(1);
    expect(dummy.delays[0]!.turns).toBe(turns);
    dummy.statuses.poison = 2;
    dummy.statuses.burn = 2;
    const hp0 = dummy.hp;
    sc.log = [];
    doAct(sc, { type: 'endTurn' });
    const ticks = sc.log.map((l) => JSON.parse(l) as CEvent).filter((e) => e.t === 'delayTick' && e.target === dummy.uid);
    expect(ticks.length).toBe(1);
    // burn (enemy turn start) + poison (enemy turn end) both hit once
    const dots = sc.log.map((l) => JSON.parse(l) as CEvent).filter((e) => e.t === 'damage' && e.target === dummy.uid && (e.kind === 'burn' || e.kind === 'poison'));
    expect(dots.map((e) => e.t === 'damage' && e.kind).sort()).toEqual(['burn', 'poison']);
    expect(dummy.hp).toBeLessThan(hp0);
  });

  it('心材坠 armor from a death during the enemy turn soaks the rest of that enemy turn', () => {
    const sc = sandbox('t:hw-enemy-turn');
    const s = sc.s;
    equipCard(s, 'player', { uid: newUid(s), id: 'g_heartwood_pendant', up: false });
    settle(sc);
    const pc = commanderOf(s, 'player')!;
    const u = spawn(sc, 'player');
    u.hp = 1;
    u.extraKeywords.push('taunt');
    sc.log = [];
    doAct(sc, { type: 'endTurn' });
    expect(unit(s, u.uid)).toBeUndefined();
    const evs = sc.log.map((l) => JSON.parse(l) as CEvent);
    const died = evs.findIndex((e) => e.t === 'death' && e.uid === u.uid);
    const gained = evs.findIndex((e) => e.t === 'armor' && e.target === pc.uid && e.amount === 2);
    expect(died).toBeGreaterThanOrEqual(0);
    expect(gained).toBeGreaterThan(died);
    expect(evs.slice(gained).some((e) => e.t === 'damage' && e.target === pc.uid && e.armorLoss > 0)).toBe(true);
  });

  it('a stunned player character recovers after sitting out one turn', () => {
    const sc = sandbox('t:stun');
    const s = sc.s;
    const pc = commanderOf(s, 'player')!;
    equipCard(s, 'player', { uid: newUid(s), id: 'r_bronze_saber', up: false });
    settle(sc);
    fx(sc, 'enemy', [{ op: 'status', status: 'stun', amount: 1, target: 'enemyCommander' }]);
    expect(pc.statuses.stun).toBe(1);
    expect(canAttack(s, pc)).toBe(false);
    doAct(sc, { type: 'endTurn' });
    expect(s.turn).toBe(2);
    expect(pc.statuses.stun ?? 0).toBe(0);
    expect(canAttack(s, pc)).toBe(true);
  });

  it('an enemy move\'s attack damage (damage attack:true) counts as an attack (rl_tomb_beast_horn)', () => {
    const found = [...c.enemies.values()].flatMap((e) => Object.entries(e.moves).map(([m, mv]) => ({ e, m, mv })))
      .find(({ e, mv }) => e.row !== 'commander' && mv.effects.some((x) => x.op === 'damage' && !!x.attack && x.target === 'target')
        && !mv.effects.some((x) => x.op === 'attack' || x.op === 'judge'));
    expect(found).toBeDefined();
    const sc = sandbox('t:horn', ['rl_tomb_beast_horn']);
    const s = sc.s;
    const pc = commanderOf(s, 'player')!;
    const before = new Set(unitsOf(s, 'enemy').map((u) => u.uid));
    fx(sc, 'enemy', [{ op: 'summon', unit: found!.e.id }]);
    const foe = unitsOf(s, 'enemy').find((u) => !before.has(u.uid))!;
    foe.ward = 0;
    const hp0 = foe.hp;
    s.tasks.push({ k: 'chain', stage: 'resolve', links: [{ kind: 'move', uid: foe.uid, move: found!.m, target: pc.uid }], passes: 0, origin: 'enemy' });
    settle(sc);
    const hits = sc.log.map((l) => JSON.parse(l) as CEvent).filter((e) => e.t === 'damage' && e.target === foe.uid);
    expect(hits.length).toBeGreaterThan(0);
    expect(foe.hp).toBeLessThan(hp0);
  });

  it('player-resource effects owned by the enemy side act for the enemy, not the player', () => {
    const sc = sandbox('t:enemy-draw');
    const s = sc.s;
    makeEnemyCommander(s, 'sandbox_dummy');
    s.sides.enemy.deck = Array.from({ length: 4 }, () => ({ uid: newUid(s), id: 'ec_a_shield_wall', up: false }));
    const hand = s.hand.length, src = s.sources.length, e0 = s.sides.enemy.energy;
    fx(sc, 'enemy', [{ op: 'draw', n: 2 }, { op: 'energy', n: 1 }, { op: 'gainSource', n: 1, color: 'R' }, { op: 'refresh', n: 3 }]);
    expect(s.hand.length).toBe(hand);
    expect(s.sources.length).toBe(src);
    expect(s.sides.enemy.hand.length).toBe(2);
    expect(s.sides.enemy.energy).toBe(e0 + 2);
  });
});
