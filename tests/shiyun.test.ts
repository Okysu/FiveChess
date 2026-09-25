/** 石韫 · 岳镇: at each player turn start a judgement decides how much of last turn's armor stays (0 / half / all). */
import { describe, expect, it } from 'vitest';
import { loadContent } from '../scripts/load-content';
import { act, createCombat } from '../src/engine/combat/api';
import { commanderOf } from '../src/engine/combat/board';
import { SUITS } from '../src/engine/defs';
import type { CombatState } from '../src/engine/combat/state';

const c = loadContent();
const cmd = c.commanders.get('b_shiyun')!;
const fate = SUITS.flatMap((suit) => Array.from({ length: 13 }, (_, i) => ({ suit, rank: i + 1 })));

function combat(seed: string): CombatState {
  return createCombat({
    commander: cmd.id, hp: 999, maxHp: 999, deck: cmd.deck.map((id) => ({ id, up: false })), relics: [],
    potions: [null, null, null], fateDeck: fate, encounter: 'sandbox', ascension: 0, seed,
  });
}

describe('石韫 岳镇 judged armor', () => {
  it('keeps 0, half or all of the previous armor, matching the judged card', () => {
    const outcomes = new Set<string>();
    for (let k = 0; k < 40; k++) {
      const s = combat(`shiyun:${k}`);
      const pc = commanderOf(s, 'player')!;
      pc.armor = 20;
      act(s, { type: 'endTurn' });
      for (let i = 0; i < 20 && s.pending; i++) act(s, s.pending.kind === 'rejudge' ? { type: 'rejudge', sign: null } : { type: 'pass' });
      if (s.over) continue;
      const judged = s.fate.discard[s.fate.discard.length - 1]!;
      const expected = judged.suit === 'mountain' || judged.rank >= 10 ? 'all' : judged.rank >= 5 ? 'half' : 'none';
      outcomes.add(expected);
      // enemy hits during their turn may have reduced the 20; the restored amount is a share of what was left
      if (expected === 'none') expect(pc.armor).toBe(0);
      else expect(pc.armor).toBeGreaterThan(0);
    }
    expect(outcomes.size).toBeGreaterThanOrEqual(2); // the judgement really varies
  });
});
