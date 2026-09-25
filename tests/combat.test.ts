import { describe, expect, it } from 'vitest';
import { act, createCombat, playableInfo } from '../src/engine/combat/api';
import type { CombatState, Unit } from '../src/engine/combat/state';
import { unitsOf, commanderOf, depth } from '../src/engine/combat/board';
import { intentPreview } from '../src/engine/combat/intents';
import { bundle, makeCombat, validateBundle, fullFate, useFixture } from './fixture';

let uidSeq = 5000;
function give(s: CombatState, id: string, up = false) {
  const c = { uid: uidSeq++, id, up };
  s.hand.push(c);
  return c;
}
const enemies = (s: CombatState) => unitsOf(s, 'enemy', true);
const pc = (s: CombatState) => commanderOf(s, 'player')!;
function ok(r: ReturnType<typeof act>) { if (!r.ok) throw new Error(r.error); return r; }
function setFateTop(s: CombatState, suit: 'sun' | 'moon' | 'thunder' | 'mountain', rank = 5) {
  s.fate.deck.push({ suit, rank, id: uidSeq++ });
}

describe('fixture', () => {
  it('validates against schemas', () => { expect(() => validateBundle()).not.toThrow(); });
});

describe('setup & determinism', () => {
  it('starts on player main phase with 5 cards and 3 sources', () => {
    const s = makeCombat();
    expect(s.phase).toBe('main');
    expect(s.turn).toBe(1);
    expect(s.hand.length).toBe(5);
    expect(s.sources.length).toBe(3);
    expect(s.sources.every((x) => x.ready)).toBe(true);
    expect(enemies(s)[0]!.intent?.move).toBe('hit');
  });

  it('same seed + same actions reproduce identical state', () => {
    const runOnce = () => {
      const s = makeCombat({ seed: 'repro', encounter: 'e_mix' });
      for (let t = 0; t < 4 && !s.over; t++) {
        const card = s.hand.find((c) => c.id === 't_strike');
        const e = enemies(s)[0];
        if (card && e) act(s, { type: 'play', card: card.uid, target: e.uid });
        act(s, { type: 'endTurn' });
      }
      return JSON.stringify({ units: s.units, hand: s.hand, rng: s.rng, fate: s.fate });
    };
    expect(runOnce()).toBe(runOnce());
  });
});

describe('献牌为源', () => {
  it('sacrifice adds a permanent ready source of the card color, once per turn', () => {
    const s = makeCombat();
    const a = give(s, 't_red2');
    const b = give(s, 't_guard');
    ok(act(s, { type: 'sacrifice', card: a.uid }));
    expect(s.sources.length).toBe(4);
    expect(s.sources[3]).toMatchObject({ color: 'R', ready: true });
    expect(act(s, { type: 'sacrifice', card: b.uid }).ok).toBe(false);
    expect(s.sacrificed.map((c) => c.id)).toContain('t_red2');
  });

  it('offering trigger fires when sacrificed', () => {
    const s = makeCombat();
    const c = give(s, 't_offer');
    const e = enemies(s)[0]!;
    ok(act(s, { type: 'sacrifice', card: c.uid }));
    expect(e.hp).toBe(17);
  });

  it('colored pips must be paid with matching sources', () => {
    const s = makeCombat();
    s.sources = [{ color: 'N', ready: true }, { color: 'B', ready: true }];
    const c = give(s, 't_red2');
    expect(playableInfo(s, c).reason).toBe('cost');
    s.sources.push({ color: 'R', ready: true });
    expect(playableInfo(s, c).playable).toBe(true);
    const e = enemies(s)[0]!;
    ok(act(s, { type: 'play', card: c.uid, target: e.uid }));
    // R used for the pip; generic paid with N (least demanded) rather than B
    expect(s.sources.find((x) => x.color === 'B')!.ready).toBe(true);
    expect(e.hp).toBe(10);
  });
});

describe('battle lines', () => {
  it('commander depth depends on non-empty rows; taunt forces enemy targets', () => {
    const s = makeCombat();
    const w = give(s, 't_wall');
    expect(depth(s, pc(s))).toBe(1);
    ok(act(s, { type: 'play', card: w.uid, slot: { row: 'front', slot: 1 } }));
    expect(depth(s, pc(s))).toBe(2);
    ok(act(s, { type: 'endTurn' }));
    // brute re-targets to the taunt wall at declaration
    const wall = unitsOf(s, 'player').find((u) => u.def === 't_wall')!;
    expect(wall.hp).toBe(3);
    expect(pc(s).hp).toBe(50);
  });

  it('back-row melee units cannot attack; units cannot attack the turn they enter', () => {
    const s = makeCombat({ encounter: 'e_dummy' });
    const a = give(s, 't_soldier');
    const b = give(s, 't_soldier');
    ok(act(s, { type: 'play', card: a.uid, slot: { row: 'front', slot: 0 } }));
    ok(act(s, { type: 'play', card: b.uid, slot: { row: 'back', slot: 0 } }));
    const [front, back] = unitsOf(s, 'player') as [Unit, Unit];
    const dummy = enemies(s)[0]!;
    expect(act(s, { type: 'attack', attacker: front.uid, target: dummy.uid }).ok).toBe(false);
    ok(act(s, { type: 'endTurn' }));
    expect(act(s, { type: 'attack', attacker: back.uid, target: dummy.uid }).ok).toBe(false);
    ok(act(s, { type: 'attack', attacker: front.uid, target: dummy.uid }));
    expect(dummy.hp).toBe(28);
  });

  it('melee attacks trigger simultaneous retaliation', () => {
    const s = makeCombat();
    const a = give(s, 't_soldier');
    ok(act(s, { type: 'play', card: a.uid, slot: { row: 'front', slot: 0 } }));
    const sold = unitsOf(s, 'player')[0]!;
    sold.enteredTurn = 0; // allow attack
    const brute = enemies(s)[0]!;
    ok(act(s, { type: 'attack', attacker: sold.uid, target: brute.uid }));
    expect(brute.hp).toBe(18);
    expect(sold.dead).toBe(true);
    // card returns to discard pile
    expect(s.discard.some((c) => c.id === 't_soldier')).toBe(true);
  });

  it('commander weapon attacks use durability', () => {
    const s = makeCombat({ encounter: 'e_dummy' });
    const w = give(s, 't_sword');
    ok(act(s, { type: 'play', card: w.uid }));
    const d = enemies(s)[0]!;
    ok(act(s, { type: 'attack', attacker: pc(s).uid, target: d.uid }));
    expect(d.hp).toBe(27);
    expect(s.sides.player.equip.weapon?.durability).toBe(1);
  });
});

describe('应对窗口与余烬', () => {
  it('opens a window only when a payable response card is held; blocks with embers', () => {
    const s = makeCombat();
    s.hand = [];
    give(s, 't_block');
    s.hand[0]!.id = 't_block';
    // mark block retained so it stays in hand
    const blk = s.hand[0]!;
    (blk as { costMod?: number }).costMod = 0;
    const r = act(s, { type: 'endTurn' });
    // discarded at end of turn → no window
    expect(r.ok).toBe(true);
    expect(s.pending).toBeNull();
  });

  it('responds to an enemy attack using an ember', () => {
    useFixture();
    const s = makeCombat();
    // put the block card in hand at end of turn via retain modifier: emulate by injecting after end-turn discard
    s.hand = [];
    ok(act(s, { type: 'endTurn' })); // enemy attacks, no window
    expect(pc(s).hp).toBe(45);
    // next player turn: keep the block by giving it after discard—simulate with windowed test below
    const blk = give(s, 't_block');
    // cheat retain for the test
    const def = bundle.cards.find((c) => c.id === 't_block')!;
    def.keywords = ['response', 'retain'];
    ok(act(s, { type: 'endTurn' }));
    expect(s.pending?.kind).toBe('response');
    expect(s.sources.filter((x) => x.ready).length).toBe(2); // ember cap 2
    ok(act(s, { type: 'respond', card: blk.uid }));
    expect(s.pending).toBeNull();
    // 8 armor absorbs the 5 hit
    expect(pc(s).hp).toBe(45);
    def.keywords = ['response'];
  });

  it('windowOnly cancel negates the declared action', () => {
    const s = makeCombat();
    s.hand = [];
    const def = bundle.cards.find((c) => c.id === 't_parry')!;
    def.keywords = ['response', 'retain'];
    const p = give(s, 't_parry');
    expect(playableInfo(s, p).reason).toBe('window');
    ok(act(s, { type: 'endTurn' }));
    expect(s.pending?.kind).toBe('response');
    ok(act(s, { type: 'respond', card: p.uid }));
    expect(pc(s).hp).toBe(50);
    def.keywords = ['response'];
  });
});

describe('天命判定', () => {
  it('judges by suit and moves the card to the fate discard', () => {
    const s = makeCombat();
    const e = enemies(s)[0]!;
    setFateTop(s, 'sun', 9);
    const c = give(s, 't_omen');
    ok(act(s, { type: 'play', card: c.uid, target: e.uid }));
    expect(e.hp).toBe(10);
    expect(s.fate.discard.at(-1)).toMatchObject({ suit: 'sun', rank: 9 });
    setFateTop(s, 'moon', 2);
    const c2 = give(s, 't_omen');
    ok(act(s, { type: 'play', card: c2.uid, target: e.uid }));
    expect(pc(s).armor).toBe(4);
  });

  it('a held sign can replace the judgement (改判)', () => {
    const s = makeCombat();
    const e = enemies(s)[0]!;
    setFateTop(s, 'sun', 3);
    const sg = give(s, 't_sign');
    ok(act(s, { type: 'play', card: sg.uid }));
    expect(s.fate.signs).toHaveLength(1);
    expect(s.fate.signs[0]!.suit).toBe('sun');
    setFateTop(s, 'moon', 4);
    const c = give(s, 't_omen');
    ok(act(s, { type: 'play', card: c.uid, target: e.uid }));
    expect(s.pending?.kind).toBe('rejudge');
    ok(act(s, { type: 'rejudge', sign: 0 }));
    expect(e.hp).toBe(10); // sun → yang branch
    expect(s.fate.signs).toHaveLength(0);
  });

  it('delay cards tick at the target side turn start and judge', () => {
    const s = makeCombat();
    const e = enemies(s)[0]!;
    const d = give(s, 't_thunder');
    ok(act(s, { type: 'play', card: d.uid, target: e.uid }));
    expect(e.delays).toHaveLength(1);
    setFateTop(s, 'thunder', 12);
    s.hand = [];
    ok(act(s, { type: 'endTurn' }));
    expect(e.delays).toHaveLength(0);
    expect(e.hp).toBe(0 + Math.max(0, 20 - 20));
  });
});

describe('statuses', () => {
  it('burn deals damage at owner turn start then halves', () => {
    const s = makeCombat({ encounter: 'e_dummy' });
    const e = enemies(s)[0]!;
    const c = give(s, 't_burn');
    ok(act(s, { type: 'play', card: c.uid, target: e.uid }));
    s.hand = [];
    ok(act(s, { type: 'endTurn' }));
    expect(e.hp).toBe(21);
    expect(e.statuses.burn).toBe(4);
  });

  it('vulnerable ×1.5 and weak ×0.75 on attack damage', () => {
    const s = makeCombat({ encounter: 'e_dummy' });
    const e = enemies(s)[0]!;
    e.statuses.vulnerable = 2;
    pc(s).statuses.weak = 1;
    const c = give(s, 't_strike');
    ok(act(s, { type: 'play', card: c.uid, target: e.uid }));
    // 6 * .75 = 4.5 * 1.5 = 6.75 → 6
    expect(e.hp).toBe(24);
  });
});

describe('resolution order', () => {
  it('deathrattles resolve after the killing effect and summon tokens', () => {
    const s = makeCombat({ encounter: 'e_dummy' });
    const a = give(s, 't_splitter');
    ok(act(s, { type: 'play', card: a.uid, slot: { row: 'front', slot: 1 } }));
    const u = unitsOf(s, 'player')[0]!;
    u.hp = 0;
    // run a no-op action to trigger state checks through an effect: end turn
    s.hand = [];
    ok(act(s, { type: 'endTurn' }));
    expect(unitsOf(s, 'player').filter((x) => x.def === 't_sprout')).toHaveLength(2);
  });

  it('boss enters phase two below 50% hp and changes intent', () => {
    const s = makeCombat({ encounter: 'e_boss' });
    const boss = enemies(s)[0]!;
    expect(boss.kind).toBe('commander');
    boss.hp = 21;
    const c = give(s, 't_strike');
    ok(act(s, { type: 'play', card: c.uid, target: boss.uid }));
    expect(boss.phase).toBe(1);
    expect(boss.intent?.move).toBe('rage');
    const pv = intentPreview(s, boss)!;
    expect(pv.hits).toBe(2);
    expect(pv.damage).toBe(9);
  });

  it('killing the boss wins the combat', () => {
    const s = makeCombat({ encounter: 'e_boss' });
    const boss = enemies(s)[0]!;
    boss.hp = 3; boss.phase = 1;
    const c = give(s, 't_strike');
    ok(act(s, { type: 'play', card: c.uid, target: boss.uid }));
    expect(s.over).toBe('win');
  });
});

describe('fate deck', () => {
  it('has 52 cards and is shared', () => {
    useFixture();
    const s = createCombat({ commander: 't_cmd', hp: 50, maxHp: 50, deck: [{ id: 't_strike', up: false }], relics: [], potions: [], fateDeck: fullFate(), encounter: 'e_brute', ascension: 0, seed: 'f' });
    expect(s.fate.deck.length).toBe(52);
  });
});
