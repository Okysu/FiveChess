/** 破甲: a boss's attacks strip 2 armor per point of damage; everyone else's strip 1. */
import { describe, expect, it } from 'vitest';
import { loadContent } from '../scripts/load-content';
import { createCombat } from '../src/engine/combat/api';
import { commanderOf, keywordsOf, unitsOf } from '../src/engine/combat/board';
import { dealDamage } from '../src/engine/combat/core';
import { setTuning } from '../src/engine/combat/tuning';
import { SUITS } from '../src/engine/defs';

const c = loadContent();
const fate = SUITS.flatMap((suit) => Array.from({ length: 13 }, (_, i) => ({ suit, rank: i + 1 })));
const combat = (encounter: string) => createCombat({
  commander: 'r_huojin', hp: 80, maxHp: 80, deck: c.commanders.get('r_huojin')!.deck.map((id) => ({ id, up: false })), relics: [],
  potions: [null, null, null], fateDeck: fate, encounter, ascension: 0, seed: 'sunder',
});

describe('破甲 (boss armor break)', () => {
  it('a boss attack strips double armor, the rest of the hit goes through', () => {
    setTuning(false);
    const s = combat('enc1_boss_rust_general');
    const boss = commanderOf(s, 'enemy')!, pc = commanderOf(s, 'player')!;
    expect(keywordsOf(s, boss)).toContain('sunder');
    pc.armor = 10; pc.hp = 80;
    dealDamage(s, boss.uid, pc.uid, 8, 'attack', { attack: true });
    // 8 damage: 10 armor soaks 5 of it (at half value, all 10 armor gone), 3 reach HP
    expect(pc.armor).toBe(0);
    expect(pc.hp).toBe(77);
    setTuning(true);
  });

  it('armor larger than twice the hit keeps the remainder', () => {
    setTuning(false);
    const s = combat('enc1_boss_rust_general');
    const boss = commanderOf(s, 'enemy')!, pc = commanderOf(s, 'player')!;
    pc.armor = 20; pc.hp = 80;
    dealDamage(s, boss.uid, pc.uid, 6, 'attack', { attack: true });
    expect(pc.armor).toBe(8);
    expect(pc.hp).toBe(80);
    setTuning(true);
  });

  it('non-boss enemies and effect damage use armor normally', () => {
    setTuning(false);
    const s = combat('sandbox');
    const foe = unitsOf(s, 'enemy', true)[0]!, pc = commanderOf(s, 'player')!;
    expect(keywordsOf(s, foe)).not.toContain('sunder');
    pc.armor = 10; pc.hp = 80;
    dealDamage(s, foe.uid, pc.uid, 8, 'attack', { attack: true });
    expect(pc.armor).toBe(2);
    expect(pc.hp).toBe(80);
    setTuning(true);
  });
});
