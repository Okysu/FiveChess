/**
 * Content smoke tests: every card, relic, potion, commander and encounter must run through the
 * real engine without throwing. Uses the sandbox encounter (training dummies).
 */
import { describe, expect, it } from 'vitest';
import { loadContent } from '../scripts/load-content';
import { act, createCombat, playableInfo } from '../src/engine/combat/api';
import type { CombatState, PlayerAction } from '../src/engine/combat/state';
import { SUITS } from '../src/engine/defs';
import { autoAnswer } from '../src/engine/combat/autoplay';

const c = loadContent();
const commanders = [...c.commanders.values()];
const fate = SUITS.flatMap((suit) => Array.from({ length: 13 }, (_, i) => ({ suit, rank: i + 1 })));

function sandbox(seed: string, cmd = commanders[0]!, extra: Partial<Parameters<typeof createCombat>[0]> = {}): CombatState {
  return createCombat({
    commander: cmd.id, hp: cmd.hp, maxHp: cmd.hp, deck: cmd.deck.map((id) => ({ id, up: false })), relics: [{ id: cmd.relic, counter: 0 }],
    potions: [null, null, null], fateDeck: fate, encounter: 'sandbox', ascension: 0, seed, ...extra,
  });
}

function drive(s: CombatState, a: PlayerAction) {
  const r = act(s, a);
  for (let i = 0; i < 20 && s.pending; i++) act(s, autoAnswer(s));
  return r;
}

const hasContent = commanders.length > 0;

describe.skipIf(!hasContent)('every card plays without errors', () => {
  const cards = [...c.cards.values()].filter((d) => d.type !== 'status' && d.type !== 'curse');
  for (const def of cards) {
    for (const up of def.upgrade ? [false, true] : [false]) {
      it(`${def.id}${up ? '+' : ''}`, () => {
        const s = sandbox(`card:${def.id}`);
        s.sources = (['R', 'B', 'G', 'Y', 'P', 'R', 'B', 'G', 'Y', 'P'] as const).map((color) => ({ color, ready: true }));
        s.fate.signs = [{ suit: 'sun', rank: 9, id: 99999 }];
        const card = { uid: 90000, id: def.id, up };
        s.hand.push(card);
        const info = playableInfo(s, card);
        if (def.windowOnly) {
          drive(s, { type: 'endTurn' });
        } else if (info.playable) {
          const target = info.targets ? info.targets[info.targets.length - 1] ?? null : null;
          const r = drive(s, { type: 'play', card: card.uid, target, slot: info.slots?.[0] ?? null });
          expect(r.ok, r.error).toBe(true);
        }
        for (let t = 0; t < 2 && !s.over; t++) drive(s, { type: 'endTurn' });
        expect(s.over === 'lose').toBe(false);
      });
    }
  }
});

describe.skipIf(!hasContent)('sacrificing every card works', () => {
  for (const def of c.cards.values()) {
    it(def.id, () => {
      const s = sandbox(`sac:${def.id}`);
      const card = { uid: 90001, id: def.id, up: false };
      s.hand.push(card);
      const r = drive(s, { type: 'sacrifice', card: card.uid });
      expect(r.ok, r.error).toBe(true);
      drive(s, { type: 'endTurn' });
    });
  }
});

describe.skipIf(!hasContent)('relics run through a combat', () => {
  for (const r of c.relics.values()) {
    it(r.id, () => {
      const s = sandbox(`relic:${r.id}`, commanders[0], { relics: [{ id: r.id, counter: 0 }] });
      for (let t = 0; t < 3 && !s.over; t++) {
        for (const card of [...s.hand]) {
          const info = playableInfo(s, card);
          if (info.playable) drive(s, { type: 'play', card: card.uid, target: info.targets?.[0] ?? null, slot: info.slots?.[0] ?? null });
        }
        drive(s, { type: 'endTurn' });
      }
      expect(true).toBe(true);
    });
  }
});

describe.skipIf(!hasContent)('potions', () => {
  for (const p of c.potions.values()) {
    it(p.id, () => {
      const s = sandbox(`potion:${p.id}`, commanders[0], { potions: [p.id, null, null] });
      const targets = p.target === 'none' ? null : (s.sides.enemy.front.filter((x) => x != null) as number[]);
      const tgt = p.target === 'friendly' || p.target === 'friendlyUnit' ? s.sides.player.commander : targets?.[0] ?? null;
      const r = drive(s, { type: 'potion', slot: 0, target: tgt });
      if (p.target !== 'friendlyUnit') expect(r.ok, r.error).toBe(true);
    });
  }
});

describe.skipIf(!hasContent)('commanders and skills', () => {
  for (const cmd of commanders) {
    it(cmd.id, () => {
      const s = sandbox(`cmd:${cmd.id}`, cmd);
      for (let t = 0; t < 4 && !s.over; t++) {
        s.skills.forEach((_, i) => {
          const tg = s.sides.enemy.front.find((x) => x != null) ?? s.sides.player.commander;
          const r = act(s, { type: 'skill', skill: i, target: tg });
          if (!r.ok) act(s, { type: 'skill', skill: i, target: null });
          for (let k = 0; k < 10 && s.pending; k++) act(s, autoAnswer(s));
        });
        drive(s, { type: 'endTurn' });
      }
    });
  }
});

describe.skipIf(!hasContent)('encounters run', () => {
  for (const en of c.encounters.values()) {
    it(en.id, () => {
      const cmd = commanders[0]!;
      const s = createCombat({
        commander: cmd.id, hp: 999, maxHp: 999, deck: cmd.deck.map((id) => ({ id, up: false })), relics: [], potions: [],
        fateDeck: fate, encounter: en.id, ascension: 15, seed: `enc:${en.id}`,
      });
      for (let t = 0; t < 6 && !s.over; t++) drive(s, { type: 'endTurn' });
      expect(s.over).not.toBe('win');
    });
  }
});
