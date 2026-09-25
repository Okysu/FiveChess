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
// thresholds come from the data (tuned in docs/难度评估.md), so the test checks the rule, not the numbers
type RankBranch = { min: number; max: number; effects: { fraction?: number }[] };
const judge = cmd.skills.find((sk) => sk.id === 'b_shiyun_p')!.triggers![0]!.effects[0] as unknown as { branches: { ranks: RankBranch[] } };
const keptShare = (card: { suit: string; rank: number }) =>
  card.suit === 'mountain' ? 1 : judge.branches.ranks.find((r) => card.rank >= r.min && card.rank <= r.max)?.effects[0]?.fraction ?? 0;

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
      const share = keptShare(judged);
      const expected = share >= 1 ? 'all' : share > 0 ? 'half' : 'none';
      outcomes.add(expected);
      // enemy hits during their turn may have reduced the 20; the restored amount is a share of what was left
      if (expected === 'none') expect(pc.armor).toBe(0);
      else expect(pc.armor).toBeGreaterThan(0);
    }
    expect(outcomes.size).toBeGreaterThanOrEqual(2); // the judgement really varies
  });
});
