/**
 * The cost disc must be the price: for every playable card (base and upgraded), the number shown (generic + colored,
 * from liveCard) equals the printed cost with no modifiers, and playing the card spends exactly that many sources.
 * Cards that give sources back as their effect (重置 / 临时源) are compared on the payment itself.
 */
import { describe, expect, it } from 'vitest';
import { loadContent } from '../scripts/load-content';
import { act, createCombat, playableInfo } from '../src/engine/combat/api';
import { liveCard } from '../src/game/scenes/combat/live';
import { SUITS, type Color } from '../src/engine/defs';
import { setTuning } from '../src/engine/combat/tuning';

const c = loadContent();
const fate = SUITS.flatMap((suit) => Array.from({ length: 13 }, (_, i) => ({ suit, rank: i + 1 })));
const COLORS: Color[] = ['R', 'B', 'G', 'Y', 'P', 'N'];
/** effects that hand sources back, so "ready before − ready after" is not the price */
const refunds = (id: string, up: boolean) => /"op":"(refresh|energy|gainSource)"/.test(JSON.stringify(c.card(id, up).effects ?? []));

describe('cost disc = price paid', () => {
  it('holds for every playable card', () => {
    setTuning(false);
    const bad: string[] = [];
    let n = 0;
    for (const d of c.cards.values()) {
      if (['status', 'curse'].includes(d.type) || d.unplayable) continue;
      for (const up of [false, true]) {
        if (up && !d.upgrade) continue;
        const def = c.card(d.id, up);
        const s = createCombat({ commander: 'r_huojin', hp: 80, maxHp: 80, deck: [], relics: [], potions: [null, null, null], fateDeck: fate, encounter: 'sandbox', ascension: 0, seed: `cost:${d.id}` });
        s.sources = COLORS.flatMap((col) => [0, 1].map(() => ({ color: col, ready: true })));
        s.hand = [{ uid: 9000, id: d.id, up }];
        const card = s.hand[0]!;
        const live = liveCard(s, card);
        const label = `${d.id}${up ? '+' : ''}`;
        if (def.cost.g === 'X') continue;
        const shown = live.cost!.g + live.cost!.c.length;
        const printed = (def.cost.g as number) + (def.cost.c ?? []).length;
        if (shown !== printed) bad.push(`${label}: shows ${shown}, printed ${printed}`);
        const info = playableInfo(s, card);
        if (!info.playable) continue; // response-window-only or needs a target the sandbox lacks
        if (info.payment && info.payment.length !== shown) bad.push(`${label}: shows ${shown}, pays ${info.payment.length}`);
        if (refunds(d.id, up)) continue;
        const before = s.sources.filter((x) => x.ready).length;
        const r = act(s, { type: 'play', card: card.uid, target: info.targets?.[0] ?? null, slot: d.type === 'unit' ? { row: 'front', slot: 1 } : null });
        if (!r.ok) continue;
        n++;
        const spent = before - s.sources.filter((x) => x.ready).length;
        if (spent !== shown) bad.push(`${label}: shows ${shown}, spent ${spent}`);
      }
    }
    setTuning(true);
    expect(n).toBeGreaterThan(500);
    expect(bad).toEqual([]);
  });
});
