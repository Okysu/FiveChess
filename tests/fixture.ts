import { z } from 'zod';
import { Content, setContent, type ContentBundle } from '../src/engine/content';
import { zCard, zCommander, zEnemy, zEncounter, zRelic, zLieutenant, zPotion } from '../src/engine/schema';
import type { CardDef } from '../src/engine/defs';
import { createCombat } from '../src/engine/combat/api';
import type { CombatConfig } from '../src/engine/combat/state';
import { SUITS } from '../src/engine/defs';

const art = { subject: 'test subject art' };
const card = (c: Omit<CardDef, 'art'> & { art?: CardDef['art'] }): CardDef => ({ art, ...c });

export const cards: CardDef[] = [
  card({ id: 't_strike', name: '斩', faction: 'R', type: 'tactic', rarity: 'basic', cost: { g: 1 }, text: '造成{d}点伤害。', vars: { d: 6 }, target: 'enemy', effects: [{ op: 'damage', amount: '$d', target: 'target', attack: true }] }),
  card({ id: 't_guard', name: '守', faction: 'B', type: 'tactic', rarity: 'basic', cost: { g: 1 }, text: '获得{a}护甲。', vars: { a: 5 }, effects: [{ op: 'armor', amount: '$a', target: 'commander' }] }),
  card({ id: 't_red2', name: '赤二', faction: 'R', type: 'tactic', rarity: 'common', cost: { g: 1, c: ['R'] }, text: '', target: 'enemy', effects: [{ op: 'damage', amount: 10, target: 'target' }] }),
  card({ id: 't_soldier', name: '兵', faction: 'R', type: 'unit', rarity: 'common', cost: { g: 1 }, text: '', unit: { atk: 2, hp: 3 } }),
  card({ id: 't_wall', name: '墙', faction: 'B', type: 'unit', rarity: 'common', cost: { g: 1 }, text: '', unit: { atk: 0, hp: 8, keywords: ['taunt'] } }),
  card({ id: 't_block', name: '挡', faction: 'B', type: 'response', rarity: 'common', cost: { g: 1 }, text: '', keywords: ['response'], effects: [{ op: 'armor', amount: 8, target: 'commander' }] }),
  card({ id: 't_parry', name: '拆', faction: 'B', type: 'response', rarity: 'common', cost: { g: 1 }, text: '', keywords: ['response'], windowOnly: true, effects: [{ op: 'cancel' }] }),
  card({ id: 't_omen', name: '卜', faction: 'Y', type: 'tactic', rarity: 'common', cost: { g: 0 }, text: '', target: 'enemy', effects: [{ op: 'judge', branches: { yang: [{ op: 'damage', amount: 10, target: 'target' }], yin: [{ op: 'armor', amount: 4, target: 'commander' }] } }] }),
  card({ id: 't_sign', name: '签', faction: 'Y', type: 'tactic', rarity: 'common', cost: { g: 0 }, text: '', effects: [{ op: 'sign', n: 1 }] }),
  card({ id: 't_thunder', name: '雷劫', faction: 'Y', type: 'delay', rarity: 'common', cost: { g: 0 }, text: '', delay: { turns: 1, on: 'enemy', branches: { thunder: [{ op: 'damage', amount: 20, target: 'target' }], always: [{ op: 'status', status: 'weak', amount: 1, target: 'target' }] } } }),
  card({ id: 't_splitter', name: '裂', faction: 'G', type: 'unit', rarity: 'common', cost: { g: 0 }, text: '', unit: { atk: 1, hp: 1, triggers: [{ on: 'death', effects: [{ op: 'summon', unit: 't_sprout', n: 2 }] }] } }),
  card({ id: 't_sprout', name: '芽', faction: 'G', type: 'unit', rarity: 'token', cost: { g: 0 }, text: '', unit: { atk: 1, hp: 1 } }),
  card({ id: 't_burn', name: '燃', faction: 'R', type: 'tactic', rarity: 'common', cost: { g: 0 }, text: '', target: 'enemy', effects: [{ op: 'status', status: 'burn', amount: 9, target: 'target' }] }),
  card({ id: 't_offer', name: '祭', faction: 'R', type: 'tactic', rarity: 'common', cost: { g: 9 }, text: '', keywords: ['offering'], onSacrifice: [{ op: 'damage', amount: 3, target: 'allEnemies' }] }),
  card({ id: 't_sword', name: '剑', faction: 'R', type: 'equip', rarity: 'common', cost: { g: 0 }, text: '', equip: { slot: 'weapon', atk: 3, range: 1, durability: 2 } }),
];

export const bundle: ContentBundle = {
  cards,
  commanders: [{
    id: 't_cmd', name: '测帅', title: '测', faction: 'R', hp: 50, sources: ['R', 'R', 'N'],
    deck: ['t_strike', 't_strike', 't_strike', 't_strike', 't_strike', 't_guard', 't_guard', 't_guard', 't_guard', 't_guard'],
    relic: 't_relic', lore: '', ending: '', art,
    skills: [
      { id: 'sk_p', name: '被动', type: 'passive', text: '' },
      { id: 'sk_a', name: '主动', type: 'active', text: '', effects: [{ op: 'armor', amount: 3, target: 'commander' }] },
    ],
  }],
  lieutenants: [],
  enemies: [
    { id: 't_brute', name: '莽', act: 1, tier: 'normal', hp: [20, 20], atk: 5, row: 'front', lore: '', art,
      moves: { hit: { name: '砸', intent: ['attack'], effects: [{ op: 'attack', target: 'target' }] } }, ai: { type: 'cycle', sequence: ['hit'] } },
    { id: 't_archer', name: '弓', act: 1, tier: 'normal', hp: [10, 10], atk: 3, row: 'back', keywords: ['ranged'], lore: '', art,
      moves: { shoot: { name: '射', intent: ['attack'], effects: [{ op: 'attack', target: 'target' }], target: 'commander' } }, ai: { type: 'cycle', sequence: ['shoot'] } },
    { id: 't_dummy', name: '桩', act: 1, tier: 'normal', hp: [30, 30], atk: 0, row: 'front', lore: '', art,
      moves: { wait: { name: '等', intent: ['defend'], effects: [{ op: 'armor', amount: 0, target: 'self' }] } }, ai: { type: 'cycle', sequence: ['wait'] } },
    { id: 't_boss', name: '首', act: 1, tier: 'boss', hp: [40, 40], atk: 4, row: 'commander', lore: '', art,
      moves: { smash: { name: '击', intent: ['attack'], effects: [{ op: 'attack', target: 'target' }] } }, ai: { type: 'cycle', sequence: ['smash'] },
      phases: [{ hpBelow: 0.5, name: '二阶段', text: '', atk: 9, ai: { type: 'cycle', sequence: ['rage'] }, moves: { rage: { name: '怒', intent: ['attack'], effects: [{ op: 'attack', target: 'target', times: 2 }] } } }] },
  ],
  encounters: [
    { id: 'e_brute', act: 1, tier: 'normal', enemies: [{ id: 't_brute' }] },
    { id: 'e_dummy', act: 1, tier: 'normal', enemies: [{ id: 't_dummy' }] },
    { id: 'e_mix', act: 1, tier: 'normal', enemies: [{ id: 't_brute' }, { id: 't_archer' }] },
    { id: 'e_boss', act: 1, tier: 'boss', enemies: [{ id: 't_boss' }] },
  ],
  relics: [{ id: 't_relic', name: '遗', tier: 'starter', text: '', art }],
  potions: [],
  events: [],
};

export function validateBundle() {
  z.array(zCard).parse(bundle.cards);
  z.array(zCommander).parse(bundle.commanders);
  z.array(zEnemy).parse(bundle.enemies);
  z.array(zEncounter).parse(bundle.encounters);
  z.array(zRelic).parse(bundle.relics);
  z.array(zLieutenant).parse(bundle.lieutenants);
  z.array(zPotion).parse(bundle.potions);
}

export function useFixture() {
  setContent(new Content(bundle));
}

export function fullFate() {
  const out: { suit: (typeof SUITS)[number]; rank: number }[] = [];
  for (const suit of SUITS) for (let r = 1; r <= 13; r++) out.push({ suit, rank: r });
  return out;
}

export function makeCombat(over: Partial<CombatConfig> = {}) {
  useFixture();
  return createCombat({
    commander: 't_cmd', hp: 50, maxHp: 50,
    deck: bundle.commanders[0]!.deck.map((id) => ({ id, up: false })),
    relics: [], potions: [null, null, null], fateDeck: fullFate(), encounter: 'e_brute', ascension: 0, seed: 'test', ...over,
  });
}
