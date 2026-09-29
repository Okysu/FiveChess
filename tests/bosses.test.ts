/** 1.1 百鬼夜行: each new boss / elite mechanic and the 精英词缀, driven through the real engine. */
import { describe, expect, it } from 'vitest';
import { loadContent } from '../scripts/load-content';
import { act, createCombat } from '../src/engine/combat/api';
import { autoAnswer } from '../src/engine/combat/autoplay';
import { commanderOf, unitsOf } from '../src/engine/combat/board';
import { checkState, dealDamage as rawDamage, pushFx, run } from '../src/engine/combat/core';
import type { AnyEffect, CombatState, PlayerAction, Unit } from '../src/engine/combat/state';
import { SUITS } from '../src/engine/defs';

const c = loadContent();
const fate = SUITS.flatMap((suit) => Array.from({ length: 13 }, (_, i) => ({ suit, rank: i + 1 })));

function fight(encounter: string, o: { commander?: string; relics?: string[]; affixes?: string[]; seed?: string } = {}): CombatState {
  const cmd = c.commander(o.commander ?? 'r_huojin');
  return createCombat({
    commander: cmd.id, hp: 400, maxHp: 400, deck: cmd.deck.map((id) => ({ id, up: false })), relics: (o.relics ?? []).map((id) => ({ id, counter: 0 })),
    potions: [], fateDeck: fate, encounter, ascension: 0, seed: o.seed ?? `boss:${encounter}`, affixes: o.affixes,
  });
}
function drive(s: CombatState, a: PlayerAction) {
  const r = act(s, a);
  for (let i = 0; i < 60 && s.pending && !s.over; i++) act(s, autoAnswer(s));
  return r;
}
/** run a boss move / script as that enemy */
function asEnemy(s: CombatState, u: Unit, effects: AnyEffect[], extra: Partial<{ event: { source: null; target: number; amount: number } }> = {}) {
  pushFx(s, effects, { side: 'enemy', source: u.uid, kind: 'move', target: commanderOf(s, 'player')!.uid, vars: { atk: u.baseAtk }, ...extra });
  run(s);
  for (let i = 0; i < 60 && s.pending && !s.over; i++) act(s, autoAnswer(s));
}
/** deal damage and let deaths / triggers resolve, as they would inside an effect */
function dealDamage(s: CombatState, src: number, tgt: number, n: number, kind: Parameters<typeof rawDamage>[4]) {
  const r = rawDamage(s, src, tgt, n, kind);
  checkState(s);
  run(s);
  return r;
}
const boss = (s: CombatState) => commanderOf(s, 'enemy')!;
const player = (s: CombatState) => commanderOf(s, 'player')!;

describe('拓碑鬼·千拓', () => {
  it('remembers the last card you played and plays it back at you', () => {
    const s = fight('enc1_boss_rubbing_ghost');
    const card = { uid: 9001, id: 'r_kindle', up: false };
    s.hand.push(card);
    s.sources.push({ color: 'R', ready: true });
    expect(drive(s, { type: 'play', card: card.uid, target: boss(s).uid }).ok).toBe(true);
    expect(boss(s).mem?.rub).toBe('r_kindle');
    const hp0 = player(s).hp;
    asEnemy(s, boss(s), [{ op: 'script', id: 'rubCast' }]);
    expect(player(s).hp).toBeLessThan(hp0);
    expect(player(s).statuses.burn ?? 0).toBeGreaterThan(0);
  });
  it('falls back to its own strike before you have played anything', () => {
    const s = fight('enc1_boss_rubbing_ghost');
    const hp0 = player(s).hp;
    asEnemy(s, boss(s), [{ op: 'script', id: 'rubCast', args: { fallback: [{ op: 'damage', amount: 9, target: 'enemyCommander', attack: true }] } }]);
    expect(player(s).hp).toBeLessThan(hp0);
  });
});

describe('纸扎王', () => {
  it('holds one 灵障 per paper servant, and loses one when a servant falls', () => {
    const s = fight('enc1_boss_paper_king');
    const servants = unitsOf(s, 'enemy');
    expect(servants.length).toBe(2);
    expect(boss(s).ward).toBe(2);
    dealDamage(s, player(s).uid, servants[0]!.uid, 99, 'effect');
    run(s);
    expect(boss(s).ward).toBe(1);
  });
});

describe('宰辅·沈', () => {
  it('opens with an edict on its side of the field', () => {
    const s = fight('enc2_boss_chancellor');
    expect(s.sides.enemy.field?.card.startsWith('ec_edict_')).toBe(true);
  });
  it('禁兵: playing a unit hurts you and strengthens him', () => {
    const s = fight('enc2_boss_chancellor');
    s.sides.enemy.field = { uid: 8001, card: 'ec_edict_units', up: false, turns: 1, ts: 1 };
    const unitCard = [...c.cards.values()].find((d) => d.type === 'unit' && d.faction === 'N' && d.cost.g === 1 && !d.cost.c?.length && d.pool !== false)!;
    const card = { uid: 9002, id: unitCard.id, up: false };
    s.hand.push(card);
    const hp0 = player(s).hp, might0 = boss(s).statuses.might ?? 0;
    expect(drive(s, { type: 'play', card: card.uid, target: null }).ok).toBe(true);
    expect(player(s).hp).toBeLessThan(hp0);
    expect(boss(s).statuses.might ?? 0).toBe(might0 + 1);
  });
  it('限三: the fourth card of the turn is punished', () => {
    const s = fight('enc2_boss_chancellor');
    s.sides.enemy.field = { uid: 8002, card: 'ec_edict_three', up: false, turns: 1, ts: 1 };
    s.cardsPlayedThisTurn = 3;
    const card = { uid: 9003, id: 'n_glimpse', up: false };
    s.hand.push(card);
    s.sources.push({ color: 'N', ready: true }, { color: 'N', ready: true });
    const hp0 = player(s).hp;
    expect(drive(s, { type: 'play', card: card.uid, target: null }).ok).toBe(true);
    expect(player(s).hp).toBeLessThan(hp0);
  });
});

describe('迷途执命者', () => {
  it('becomes the shadow of a commander you are not playing — from another school', () => {
    for (const cmd of ['r_huojin', 'b_suxian', 'g_acang', 'y_xuanji', 'p_liuxu']) {
      for (let k = 0; k < 4; k++) {
        const s = fight('enc2_boss_lost_seeker', { commander: cmd, seed: `seek:${cmd}:${k}` });
        const def = c.enemy(boss(s).def);
        expect(def.variantOf).toBe('e2_boss_lost_seeker');
        expect(def.commander).not.toBe(cmd);
        expect(c.commander(def.commander!).faction).not.toBe(c.commander(cmd).faction);
        expect(s.sides.enemy.deck.length).toBeGreaterThan(0);
      }
    }
  });
  it('plays its borrowed cards', () => {
    const s = fight('enc2_boss_lost_seeker', { seed: 'seek:cast' });
    const hp0 = player(s).hp, arm0 = boss(s).armor;
    s.sides.enemy.energy = 5;
    asEnemy(s, boss(s), [{ op: 'script', id: 'bossCast' }]);
    expect(player(s).hp < hp0 || boss(s).armor > arm0 || unitsOf(s, 'enemy').length > 0 || Object.keys(player(s).statuses).length > 0).toBe(true);
  });
});

describe('蠹鱼王', () => {
  it('swallows the top of your draw pile and coughs a card into your hand every 45 damage', () => {
    const s = fight('enc3_boss_bookworm');
    const top = s.draw[s.draw.length - 1]!.id;
    asEnemy(s, boss(s), [{ op: 'script', id: 'devour', args: { n: 2 } }]);
    expect(s.sides.enemy.belly?.length).toBe(2);
    const hand0 = s.hand.length;
    dealDamage(s, player(s).uid, boss(s).uid, 50, 'effect');
    run(s);
    expect(s.sides.enemy.belly?.length).toBe(1);
    expect(s.hand.length).toBe(hand0 + 1);
    expect(s.hand.some((x) => x.id === top) || s.sides.enemy.belly!.some((x) => x.id === top)).toBe(true);
  });
});

describe('浑天仪', () => {
  it('its core takes no damage while a ring stands; the rings come round each turn', () => {
    const s = fight('enc3_boss_armillary');
    const hp0 = boss(s).hp;
    dealDamage(s, player(s).uid, boss(s).uid, 40, 'effect');
    expect(boss(s).hp).toBe(hp0);
    const front0 = unitsOf(s, 'enemy').find((u) => u.row === 'front')!.def;
    drive(s, { type: 'endTurn' });
    const front1 = unitsOf(s, 'enemy').find((u) => u.row === 'front')!.def;
    expect(front1).not.toBe(front0);
    for (const r of unitsOf(s, 'enemy')) dealDamage(s, player(s).uid, r.uid, 999, 'effect');
    run(s);
    dealDamage(s, player(s).uid, boss(s).uid, 40, 'effect');
    expect(boss(s).hp).toBeLessThan(hp0);
  });
});

describe('铁锁典狱', () => {
  it('the next cards you draw cost 1 more this turn', () => {
    const s = fight('enc2_elite_iron_warden');
    const top = s.draw.slice(-3);
    asEnemy(s, boss(s), [{ op: 'script', id: 'lockTop', args: { n: 3, amount: 1 } }]);
    for (const x of top) expect(x.costMod).toBe(1);
  });
});

describe('沉钟', () => {
  it('30 damage while it means to toll cuts the toll off', () => {
    const s = fight('enc2_elite_sunken_bell');
    const bell = boss(s);
    bell.intent = { move: 'toll', target: null };
    dealDamage(s, player(s).uid, bell.uid, 35, 'effect');
    run(s);
    expect(bell.statuses.stun ?? 0).toBe(1);
  });
});

describe('无面书吏', () => {
  it('erases a relic until it falls', () => {
    const s = fight('enc3_elite_faceless_scribe', { relics: ['rl_blade_oil'] });
    asEnemy(s, boss(s), [{ op: 'script', id: 'sealRelic' }]);
    expect(s.relics[0]!.disabled).toBe(true);
    dealDamage(s, player(s).uid, boss(s).uid, 9999, 'loss');
    run(s);
    expect(s.relics[0]!.disabled).toBeFalsy();
  });
});

describe('偷命贼', () => {
  it('steals gold; killing it returns the loot and more', () => {
    const s = fight('enc1_elite_life_thief');
    asEnemy(s, boss(s), [{ op: 'script', id: 'steal', args: { n: 12 } }]);
    expect(s.goldGained).toBe(-12);
    dealDamage(s, player(s).uid, boss(s).uid, 9999, 'loss');
    run(s);
    expect(s.goldGained).toBe(20);
  });
  it('flees with it on its fifth action', () => {
    const s = fight('enc1_elite_life_thief');
    for (let t = 0; t < 6 && !s.over; t++) drive(s, { type: 'endTurn' });
    expect(s.over).toBe('win');
    expect(s.goldGained).toBeLessThan(0);
  });
});

describe('精英词缀', () => {
  it('applies to the elite only and runs its opening effects', () => {
    const s = fight('enc1_elite_twin_hound', { affixes: ['af_warded', 'af_thorny'] });
    for (const u of unitsOf(s, 'enemy')) {
      expect(u.affixes).toEqual(['af_warded', 'af_thorny']);
      expect(u.ward).toBe(2);
      expect(u.thorns).toBe(3);
    }
    const t = fight('enc1_elite_life_thief', { affixes: ['af_warded'] });
    expect(boss(t).ward).toBe(2);
    expect(unitsOf(t, 'enemy').every((u) => !u.affixes)).toBe(true);
  });
  it('坚韧: armor at the start of each enemy turn', () => {
    const s = fight('enc2_elite_iron_warden', { affixes: ['af_tough'] });
    drive(s, { type: 'endTurn' });
    expect(boss(s).armor).toBeGreaterThanOrEqual(8);
  });
});
