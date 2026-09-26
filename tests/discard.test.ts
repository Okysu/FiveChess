/**
 * 弃置 = a card effect or skill putting a hand card into the discard pile. Playing a card and the end-of-turn hand
 * clear are not 弃置, except for triggers marked endOfTurn (幽弈残局 "包括回合结束时的弃牌", 怨碑).
 */
import { describe, expect, it } from 'vitest';
import { loadContent } from '../scripts/load-content';
import { act, createCombat, playableInfo } from '../src/engine/combat/api';
import { commanderOf, unitsOf } from '../src/engine/combat/board';
import { pushFx, run } from '../src/engine/combat/core';
import { SUITS } from '../src/engine/defs';
import type { CEvent, CombatState } from '../src/engine/combat/state';

const c = loadContent();
const fate = SUITS.flatMap((suit) => Array.from({ length: 13 }, (_, i) => ({ suit, rank: i + 1 })));
const combat = (o: { lieutenant?: string; relics?: string[]; encounter?: string }) => createCombat({
  commander: 'p_liuxu', lieutenant: o.lieutenant ?? null, hp: 80, maxHp: 80,
  deck: c.commanders.get('p_liuxu')!.deck.map((id) => ({ id, up: false })), relics: (o.relics ?? []).map((id) => ({ id, counter: 0 })),
  potions: [null, null, null], fateDeck: fate, encounter: o.encounter ?? 'sandbox', ascension: 0, seed: 'discard',
});
const drain = (s: CombatState, ev: CEvent[]) => {
  let all = [...ev];
  for (let i = 0; i < 40 && s.pending; i++) all = all.concat(act(s, s.pending.kind === 'rejudge' ? { type: 'rejudge', sign: null } : { type: 'pass' }).events);
  return all;
};
/** 1-damage hits from the player commander = 绛书 焚卷 */
const burnHits = (s: CombatState, ev: CEvent[]) => ev.filter((e) => e.t === 'damage' && e.amount === 1 && e.source === commanderOf(s, 'player')!.uid).length;

describe('弃置', () => {
  it('playing a card is not a 弃置', () => {
    const s = combat({ lieutenant: 'lt_p_jiangshu' });
    const p = s.hand.map((x) => ({ x, i: playableInfo(s, x) })).find((q) => q.i.playable)!;
    const ev = drain(s, act(s, { type: 'play', card: p.x.uid, target: p.i.targets?.[0] ?? null }).events);
    expect(s.discard.some((d) => d.uid === p.x.uid)).toBe(true);
    expect(burnHits(s, ev)).toBe(0);
  });

  it('the end-of-turn hand clear is not a 弃置', () => {
    const s = combat({ lieutenant: 'lt_p_jiangshu' });
    expect(s.hand.length).toBeGreaterThan(0);
    const ev = drain(s, act(s, { type: 'endTurn' }).events);
    expect(ev.filter((e) => e.t === 'discard').length).toBeGreaterThan(0);
    expect(burnHits(s, ev)).toBe(0);
  });

  it('a discard effect is a 弃置, once per card', () => {
    const s = combat({ lieutenant: 'lt_p_jiangshu' });
    expect(s.hand.length).toBeGreaterThanOrEqual(2);
    s.events = [];
    pushFx(s, [{ op: 'discard', n: 2, mode: 'random' }], { side: 'player', source: commanderOf(s, 'player')!.uid, kind: 'system', target: null, vars: {} });
    run(s);
    expect(s.events.filter((e) => e.t === 'discard').length).toBe(2);
    expect(burnHits(s, s.events)).toBe(2);
  });

  it('幽弈残局 says it counts the end-of-turn discards, and does', () => {
    const s = combat({ relics: ['rl_endgame_board'] });
    const n = s.hand.length;
    drain(s, act(s, { type: 'endTurn' }).events);
    const poison = unitsOf(s, 'enemy', true).reduce((a, u) => a + (u.statuses.poison ?? 0), 0);
    expect(poison).toBeGreaterThan(0);
    expect(poison).toBeLessThanOrEqual(n);
  });
});
