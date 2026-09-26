/**
 * zod schemas for all content data. Strict objects: unknown keys are errors, so typos in
 * content JSON fail the build (`npm run validate`).
 */
import { z } from 'zod';
import type {
  BlessingDef,
  CardDef, CommanderDef, Condition, Effect, EncounterDef, EnemyAI, EnemyDef, EventDef, LieutenantDef,
  Modifier, PotionDef, RelicDef, RunCondition, RunEffect, Selector, Trigger, Value, SkillDef, JudgeBranches,
} from './defs';

export const zColor = z.enum(['R', 'B', 'G', 'Y', 'P', 'N']);
export const zSuit = z.enum(['sun', 'thunder', 'moon', 'mountain']);
export const zSuitX = z.enum(['sun', 'thunder', 'moon', 'mountain', 'yang', 'yin']);
export const zKeyword = z.enum([
  'taunt', 'ranged', 'leap', 'haste', 'twinStrike', 'ward', 'lifesteal', 'deathtouch', 'thorns', 'sunder',
  'battlecry', 'deathrattle', 'growth', 'aura', 'stealth', 'response', 'judge', 'delay', 'omen',
  'exhaust', 'innate', 'retain', 'ethereal', 'combo', 'offering', 'resonance',
]);
export const zStatus = z.enum(['burn', 'poison', 'freeze', 'stun', 'vulnerable', 'weak', 'silence', 'might', 'tenacity', 'regen']);
export const zCardType = z.enum(['unit', 'tactic', 'response', 'equip', 'delay', 'field', 'status', 'curse']);
export const zRarity = z.enum(['basic', 'common', 'rare', 'epic', 'legendary', 'token', 'special']);
export const zIntent = z.enum(['attack', 'defend', 'buff', 'debuff', 'summon', 'judge', 'cast', 'unknown', 'escape', 'sleep', 'heal']);
export const zTargetSpec = z.enum(['none', 'enemy', 'enemyUnit', 'friendlyUnit', 'friendly', 'anyUnit', 'any', 'enemyNoCommander']);
export const zEquipSlot = z.enum(['weapon', 'armor', 'mount', 'treasure']);
const zRow = z.enum(['front', 'back']);

export const zCardFilter = z.object({
  type: z.union([zCardType, z.array(zCardType)]).optional(),
  faction: z.union([zColor, z.array(zColor), z.literal('own')]).optional(),
  rarity: z.union([zRarity, z.array(zRarity)]).optional(),
  keyword: zKeyword.optional(),
  id: z.string().optional(),
  maxCost: z.number().optional(),
  minCost: z.number().optional(),
}).strict();

export const zValue: z.ZodType<Value> = z.lazy(() => z.union([
  z.number(),
  z.string().regex(/^\$[a-zA-Z0-9_]+$/, 'value strings must be "$var"'),
  z.object({
    count: z.enum([
      'hand', 'drawPile', 'discardPile', 'exhaustPile', 'sources', 'readySources', 'embers', 'units', 'cardsPlayed',
      'status', 'armor', 'atk', 'hp', 'missingHp', 'maxHp', 'signs', 'judgeRank', 'x', 'lastDamage', 'turn', 'sacrificed',
      'eventAmount', 'judgesThisTurn', 'equipped', 'delays', 'counter', 'deadThisCombat', 'responsesThisCombat', 'weaponAtk', 'selected',
    ]),
    color: zColor.optional(), side: z.enum(['friendly', 'enemy']).optional(), row: zRow.optional(),
    status: zStatus.optional(), of: zSelector.optional(), suit: zSuitX.optional(),
  }).strict(),
  z.object({ add: z.array(zValue) }).strict(),
  z.object({ mul: z.array(zValue) }).strict(),
  z.object({ sub: z.tuple([zValue, zValue]) }).strict(),
  z.object({ div: z.tuple([zValue, zValue]) }).strict(),
  z.object({ max: z.array(zValue) }).strict(),
  z.object({ min: z.array(zValue) }).strict(),
]));

export const zSelector: z.ZodType<Selector> = z.lazy(() => z.union([
  z.enum([
    'self', 'commander', 'enemyCommander', 'target', 'it', 'eventSource', 'eventTarget', 'declaredActor', 'declaredTarget',
    'adjacent', 'targetAdjacent', 'allEnemies', 'enemyUnits', 'friendlyUnits', 'allFriendly', 'allUnits', 'allCharacters',
    'randomEnemy', 'randomEnemyUnit', 'randomFriendlyUnit', 'enemyFront', 'enemyBack', 'friendlyFront', 'friendlyBack',
    'otherFriendlyUnits', 'none',
  ]),
  z.object({
    side: z.enum(['friendly', 'enemy', 'both']),
    kind: z.enum(['unit', 'character', 'commander']).optional(),
    row: zRow.optional(),
    where: zCondition.optional(),
    pick: z.enum(['all', 'random', 'lowestHp', 'highestHp', 'highestAtk', 'lowestAtk', 'first']).optional(),
    n: z.number().int().positive().optional(),
    notSelf: z.boolean().optional(),
  }).strict(),
]));

const cmp = (k: string) => z.object({ [k]: z.tuple([zValue, zValue]) }).strict();
export const zCondition: z.ZodType<Condition> = z.lazy(() => z.union([
  cmp('gt'), cmp('lt'), cmp('gte'), cmp('lte'), cmp('eq'),
  z.object({ and: z.array(zCondition) }).strict(),
  z.object({ or: z.array(zCondition) }).strict(),
  z.object({ not: zCondition }).strict(),
  z.object({ hasStatus: z.object({ of: zSelector, status: zStatus }).strict() }).strict(),
  z.object({ hasKeyword: z.object({ of: zSelector, keyword: zKeyword }).strict() }).strict(),
  z.object({ isUnit: zSelector }).strict(),
  z.object({ isCommander: zSelector }).strict(),
  z.object({ alive: zSelector }).strict(),
  z.object({ inRow: z.object({ of: zSelector, row: zRow }).strict() }).strict(),
  z.object({ combo: z.number().int() }).strict(),
  z.object({ resonance: z.object({ color: zColor, n: z.number().int() }).strict() }).strict(),
  z.object({ suit: zSuitX }).strict(),
  z.object({ rank: z.object({ min: z.number().optional(), max: z.number().optional() }).strict() }).strict(),
  z.object({ chance: z.number().min(0).max(1) }).strict(),
  z.object({ inWindow: z.boolean() }).strict(),
  z.object({ declared: zIntent }).strict(),
  z.object({ myTurn: z.boolean() }).strict(),
  z.object({ eventCard: zCardFilter }).strict(),
  z.object({ hasEquip: zEquipSlot }).strict(),
  z.object({ emptySlot: z.object({ side: z.enum(['friendly', 'enemy']), row: zRow.optional() }).strict() }).strict(),
])) as z.ZodType<Condition>;

const effs = () => z.array(zEffect);
export const zJudgeBranches: z.ZodType<JudgeBranches> = z.lazy(() => z.object({
  sun: effs().optional(), thunder: effs().optional(), moon: effs().optional(), mountain: effs().optional(),
  yang: effs().optional(), yin: effs().optional(), high: effs().optional(), low: effs().optional(),
  ranks: z.array(z.object({ min: z.number(), max: z.number(), effects: effs() }).strict()).optional(),
  always: effs().optional(),
}).strict());

const o = <T extends z.ZodRawShape>(op: string, shape: T) => z.object({ op: z.literal(op), ...shape }).strict();

export const zEffect: z.ZodType<Effect> = z.lazy(() => z.discriminatedUnion('op', [
  o('damage', { amount: zValue, target: zSelector, attack: z.boolean().optional(), times: zValue.optional(), pierce: z.boolean().optional() }),
  o('attack', { attacker: zSelector.optional(), target: zSelector, amount: zValue.optional(), times: zValue.optional() }),
  o('heal', { amount: zValue, target: zSelector }),
  o('loseHp', { amount: zValue, target: zSelector }),
  o('armor', { amount: zValue, target: zSelector }),
  o('restoreArmor', { fraction: z.number().min(0).max(1), max: z.number().optional(), target: zSelector }),
  o('ward', { amount: zValue, target: zSelector }),
  o('status', { status: zStatus, amount: zValue, target: zSelector }),
  o('cleanse', { target: zSelector, what: z.union([z.enum(['debuffs', 'buffs']), zStatus]) }),
  o('buff', { target: zSelector, atk: zValue.optional(), hp: zValue.optional(), until: z.literal('turn').optional() }),
  o('kill', { target: zSelector }),
  o('silence', { target: zSelector }),
  o('addKeyword', { target: zSelector, keyword: zKeyword, value: zValue.optional() }),
  o('summon', { unit: z.string(), n: zValue.optional(), row: z.enum(['front', 'back', 'auto']).optional(), side: z.enum(['friendly', 'enemy']).optional(), atk: zValue.optional(), hp: zValue.optional() }),
  o('move', { target: zSelector, to: z.enum(['front', 'back', 'swap']) }),
  o('bounce', { target: zSelector }),
  o('transform', { target: zSelector, into: z.string() }),
  o('draw', { n: zValue }),
  o('discard', { n: zValue, mode: z.enum(['choose', 'random', 'all']), each: effs().optional() }),
  o('exhaustCards', { n: zValue, mode: z.enum(['choose', 'random']), each: effs().optional() }),
  o('create', { card: z.union([z.string(), z.object({ pool: zCardFilter }).strict()]), n: zValue.optional(), to: z.enum(['hand', 'draw', 'discard']), upgraded: z.boolean().optional(), fleeting: z.boolean().optional() }),
  o('discover', { pool: zCardFilter, n: z.number().int().optional(), upgraded: z.boolean().optional(), free: z.boolean().optional() }),
  o('fetch', { from: z.enum(['draw', 'discard', 'exhaust']), mode: z.enum(['choose', 'random', 'top']), n: zValue, filter: zCardFilter.optional() }),
  o('energy', { n: zValue, color: zColor.optional() }),
  o('gainSource', { n: zValue, color: z.union([zColor, z.literal('best')]) }),
  o('emberCap', { n: zValue }),
  o('refresh', { n: zValue }),
  o('costMod', { scope: z.enum(['hand', 'handRandom', 'nextCard']), amount: zValue, until: z.enum(['turn', 'played', 'combat']), filter: zCardFilter.optional() }),
  o('judge', { branches: zJudgeBranches, target: zSelector.optional() }),
  o('peek', { n: zValue }),
  o('stargaze', { n: zValue }),
  o('sign', { n: zValue }),
  o('fateAdd', { suit: zSuit, rank: z.number().int().min(1).max(13), n: z.number().int().optional(), where: z.enum(['top', 'shuffle']) }),
  o('delay', { card: z.string(), target: zSelector, turns: zValue.optional() }),
  o('equip', { card: z.string(), upgraded: z.boolean().optional() }),
  o('weapon', { atk: zValue.optional(), range: zValue.optional(), durability: zValue.optional() }),
  o('destroyEquip', { slot: z.union([zEquipSlot, z.literal('random')]), side: z.enum(['friendly', 'enemy']) }),
  o('field', { card: z.string() }),
  o('cancel', {}),
  o('redirect', { to: zSelector }),
  o('repeat', { times: zValue, effects: effs() }),
  o('if', { cond: zCondition, then: effs(), else: effs().optional() }),
  o('choose', { options: z.array(z.object({ text: z.string(), effects: effs() }).strict()).min(2) }),
  o('forEach', { sel: zSelector, effects: effs() }),
  o('store', { key: z.string(), value: zValue }),
  o('counter', { amount: zValue, max: z.number().int().optional(), then: effs().optional() }),
  o('gold', { n: zValue }),
  o('script', { id: z.string(), args: z.record(z.unknown()).optional() }),
])) as z.ZodType<Effect>;

export const zTriggerOn = z.enum([
  'combatStart', 'combatEnd', 'turnStart', 'turnEnd', 'opponentTurnStart', 'opponentTurnEnd', 'enter', 'death',
  'cardPlayed', 'cardSacrificed', 'cardDrawn', 'cardDiscarded', 'cardExhausted', 'cardCreated', 'unitSummoned', 'unitDied',
  'damaged', 'dealtDamage', 'attacked', 'attacking', 'healed', 'armorGained', 'armorBroken', 'statusApplied', 'judged',
  'rejudged', 'responsePlayed', 'actionDeclared', 'equipped', 'sourceGained', 'shuffled',
]);

export const zTrigger: z.ZodType<Trigger> = z.object({
  on: zTriggerOn,
  who: z.enum(['self', 'friendly', 'enemy', 'any']).optional(),
  if: zCondition.optional(),
  effects: z.array(zEffect),
  limit: z.enum(['turn', 'combat']).optional(),
  status: zStatus.optional(),
  suit: zSuitX.optional(),
}).strict();

export const zModifier: z.ZodType<Modifier> = z.object({
  stat: z.enum([
    'atk', 'maxHp', 'attackDamage', 'damageTaken', 'effectDamage', 'burnDamage', 'poisonDamage', 'armorGain', 'healing',
    'emberCap', 'draw', 'maxSources', 'handLimit', 'sacrifices', 'range', 'cost', 'signCap', 'keyword', 'judgeRank',
    'burnKeep', 'armorKeep', 'retainHand',
  ]),
  amount: zValue.optional(),
  who: z.enum(['self', 'friendly', 'enemy', 'adjacent', 'friendlyUnits', 'enemyUnits', 'commander', 'all']).optional(),
  keyword: zKeyword.optional(),
  filter: zCardFilter.optional(),
  if: zCondition.optional(),
}).strict();

const zCost = z.object({ g: z.union([z.number().int().min(0), z.literal('X')]), c: z.array(zColor.exclude(['N'])).optional() }).strict();
const zArt = z.object({ subject: z.string().min(8), mood: z.string().optional() }).strict();

const zUnitStats = z.object({
  atk: z.number().int().min(0), hp: z.number().int().min(1), keywords: z.array(zKeyword).optional(),
  thorns: z.number().int().optional(), growth: z.number().int().optional(), ward: z.number().int().optional(),
  triggers: z.array(zTrigger).optional(), aura: z.array(zModifier).optional(), modifiers: z.array(zModifier).optional(),
  prefersBack: z.boolean().optional(),
}).strict();
const zEquipStats = z.object({
  slot: zEquipSlot, atk: z.number().int().optional(), range: z.number().int().optional(), durability: z.number().int().optional(),
  mount: z.enum(['offense', 'defense']).optional(), triggers: z.array(zTrigger).optional(), modifiers: z.array(zModifier).optional(),
}).strict();
const zDelayStats = z.object({ turns: z.number().int().min(1), on: z.enum(['enemy', 'friendly', 'any']), branches: zJudgeBranches }).strict();
const zFieldStats = z.object({ duration: z.number().int().optional(), triggers: z.array(zTrigger).optional(), modifiers: z.array(zModifier).optional() }).strict();

const zVarKind = z.enum(['attack', 'damage', 'armor', 'heal', 'burn', 'poison', 'other']);

export const zCard: z.ZodType<CardDef> = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string().min(1),
  faction: zColor,
  type: zCardType,
  rarity: zRarity,
  cost: zCost,
  text: z.string(),
  flavor: z.string().optional(),
  vars: z.record(z.number()).optional(),
  varKinds: z.record(zVarKind).optional(),
  keywords: z.array(zKeyword).optional(),
  target: zTargetSpec.optional(),
  effects: z.array(zEffect).optional(),
  onSacrifice: z.array(zEffect).optional(),
  inHand: z.array(zTrigger).optional(),
  windowOnly: z.boolean().optional(),
  unit: zUnitStats.optional(),
  equip: zEquipStats.optional(),
  delay: zDelayStats.optional(),
  field: zFieldStats.optional(),
  unplayable: z.boolean().optional(),
  upgrade: z.object({
    name: z.string().optional(), text: z.string().optional(), cost: zCost.optional(), vars: z.record(z.number()).optional(),
    keywords: z.array(zKeyword).optional(), effects: z.array(zEffect).optional(), target: zTargetSpec.optional(),
    unit: zUnitStats.partial().optional(), equip: zEquipStats.partial().optional(), delay: zDelayStats.partial().optional(),
    field: zFieldStats.partial().optional(), onSacrifice: z.array(zEffect).optional(), inHand: z.array(zTrigger).optional(),
    windowOnly: z.boolean().optional(), qualitative: z.boolean().optional(),
  }).strict().optional(),
  art: zArt,
  pool: z.boolean().optional(),
}).strict() as z.ZodType<CardDef>;

export const zSkill: z.ZodType<SkillDef> = z.lazy(() => z.object({
  id: z.string(), name: z.string(), type: z.enum(['passive', 'active', 'limited', 'awaken']), text: z.string(),
  cost: zCost.optional(), target: zTargetSpec.optional(), effects: z.array(zEffect).optional(),
  triggers: z.array(zTrigger).optional(), modifiers: z.array(zModifier).optional(),
  awaken: z.object({
    on: zTriggerOn,
    who: z.enum(['self', 'friendly', 'enemy', 'any']).optional(),
    if: zCondition.optional(),
    effects: z.array(zEffect).optional(),
    becomes: z.object({
      id: z.string().optional(), name: z.string(), type: z.enum(['passive', 'active', 'limited', 'awaken']), text: z.string(),
      cost: zCost.optional(), target: zTargetSpec.optional(), effects: z.array(zEffect).optional(),
      triggers: z.array(zTrigger).optional(), modifiers: z.array(zModifier).optional(),
    }).strict().optional(),
  }).strict().optional(),
}).strict()) as z.ZodType<SkillDef>;

export const zCommander: z.ZodType<CommanderDef> = z.object({
  id: z.string(), name: z.string(), title: z.string(), faction: zColor.exclude(['N']), hp: z.number().int(),
  sources: z.array(zColor), deck: z.array(z.string()).min(10).max(12), relic: z.string(), skills: z.array(zSkill).length(2),
  alt: z.object({ relic: z.string(), replaces: z.string(), skill: zSkill }).strict().optional(),
  lore: z.string(), ending: z.string(), unlock: z.string().optional(), art: zArt,
}).strict() as z.ZodType<CommanderDef>;

export const zLieutenant: z.ZodType<LieutenantDef> = z.object({
  id: z.string(), name: z.string(), title: z.string(), faction: zColor.exclude(['N']), skill: zSkill, lore: z.string(), art: zArt,
}).strict() as z.ZodType<LieutenantDef>;

const zMove = z.object({
  name: z.string(), intent: z.array(zIntent).min(1), effects: z.array(zEffect),
  target: z.enum(['default', 'commander', 'randomUnit', 'lowestHp', 'highestAtk', 'self', 'ally', 'allyLowest', 'none']).optional(),
}).strict();

export const zEnemyAI: z.ZodType<EnemyAI> = z.lazy(() => z.union([
  z.object({ type: z.literal('cycle'), sequence: z.array(z.string()).min(1), start: z.union([z.literal('random'), z.number()]).optional() }).strict(),
  z.object({ type: z.literal('weighted'), weights: z.record(z.number()), noRepeat: z.number().int().optional() }).strict(),
  z.object({
    type: z.literal('script'), first: z.array(z.string()).optional(),
    rules: z.array(z.object({ if: zCondition, move: z.string(), once: z.boolean().optional() }).strict()).optional(),
    then: zEnemyAI,
  }).strict(),
])) as z.ZodType<EnemyAI>;

export const zEnemy: z.ZodType<EnemyDef> = z.object({
  id: z.string(), name: z.string(), act: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  tier: z.enum(['normal', 'elite', 'boss', 'minion']), hp: z.tuple([z.number().int(), z.number().int()]), atk: z.number().int(),
  keywords: z.array(zKeyword).optional(), thorns: z.number().int().optional(), ward: z.number().int().optional(),
  row: z.enum(['front', 'back', 'commander']), moves: z.record(zMove), ai: zEnemyAI,
  passives: z.array(zTrigger).optional(), modifiers: z.array(zModifier).optional(),
  phases: z.array(z.object({
    hpBelow: z.number(), minAscension: z.number().int().optional(), name: z.string(), text: z.string(), ai: zEnemyAI, moves: z.record(zMove).optional(),
    effects: z.array(zEffect).optional(), art: zArt.optional(), atk: z.number().int().optional(),
  }).strict()).optional(),
  deck: z.array(z.string()).optional(),
  energy: z.object({ start: z.number(), perTurn: z.number(), max: z.number() }).strict().optional(),
  lore: z.string(),
  dialogue: z.object({ intro: z.string().optional(), phase: z.string().optional(), defeat: z.string().optional() }).strict().optional(),
  art: zArt,
}).strict() as z.ZodType<EnemyDef>;

export const zEncounter: z.ZodType<EncounterDef> = z.object({
  id: z.string(), act: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]), tier: z.enum(['normal', 'elite', 'boss']),
  pool: z.enum(['easy', 'hard']).optional(),
  enemies: z.array(z.object({ id: z.string(), row: z.enum(['front', 'back', 'commander']).optional(), slot: z.number().int().optional() }).strict()).min(1),
  weight: z.number().optional(), tutorial: z.enum(['response', 'judge']).optional(),
}).strict() as z.ZodType<EncounterDef>;

const zRelicTier = z.enum(['starter', 'common', 'uncommon', 'rare', 'boss', 'shop', 'event']);

export const zRunCondition: z.ZodType<RunCondition> = z.union([
  z.object({ gold: z.number() }).strict(), z.object({ hpAbove: z.number() }).strict(), z.object({ commander: z.string() }).strict(),
  z.object({ lieutenant: z.string() }).strict(), z.object({ faction: zColor }).strict(), z.object({ hasRelic: z.string() }).strict(),
  z.object({ flag: z.string() }).strict(), z.object({ act: z.number() }).strict(), z.object({ deckHas: zCardFilter }).strict(),
  z.object({ noLieutenant: z.literal(true) }).strict(),
]);

export const zRunEffect: z.ZodType<RunEffect> = z.lazy(() => z.discriminatedUnion('op', [
  o('gold', { n: z.number() }),
  o('hp', { n: z.number() }),
  o('hpPct', { pct: z.number() }),
  o('maxHp', { n: z.number() }),
  o('addCard', { card: z.string().optional(), pool: zCardFilter.optional(), n: z.number().optional(), upgraded: z.boolean().optional(), choose: z.number().optional() }),
  o('removeCard', { n: z.number(), mode: z.enum(['choose', 'random']), filter: zCardFilter.optional() }),
  o('upgradeCard', { n: z.number(), mode: z.enum(['choose', 'random']) }),
  o('transformCard', { n: z.number(), mode: z.enum(['choose', 'random']) }),
  o('duplicateCard', { n: z.number() }),
  o('addRelic', { relic: z.string().optional(), tier: zRelicTier.optional() }),
  o('loseRelic', { mode: z.enum(['random', 'choose']) }),
  o('addPotion', { potion: z.string().optional() }),
  o('fight', { encounter: z.string(), reward: z.enum(['normal', 'elite', 'none']).optional() }),
  o('fate', { action: z.enum(['remove', 'add', 'changeSuit', 'preview']), suit: zSuit.optional(), rank: z.number().optional(), n: z.number().optional() }),
  o('chance', { p: z.number(), then: z.array(zRunEffect), else: z.array(zRunEffect).optional() }),
  o('lieutenant', { id: z.string().optional() }),
  o('flag', { key: z.string() }),
  o('emberCap', { n: z.number() }),
  o('startSource', { color: z.union([zColor, z.literal('own')]) }),
])) as z.ZodType<RunEffect>;

const zRunRule = z.union([
  z.object({ rule: z.literal('restHealBonus'), amount: z.number() }).strict(),
  z.object({ rule: z.literal('shopDiscount'), pct: z.number() }).strict(),
  z.object({ rule: z.literal('extraCardChoice'), n: z.number() }).strict(),
  z.object({ rule: z.literal('goldBonus'), pct: z.number() }).strict(),
  z.object({ rule: z.literal('noHealAtRest') }).strict(),
  z.object({ rule: z.literal('potionSlots'), n: z.number() }).strict(),
  z.object({ rule: z.literal('eliteRelicExtra') }).strict(),
  z.object({ rule: z.literal('mapReveal') }).strict(),
  z.object({ rule: z.literal('removeCostDiscount'), pct: z.number() }).strict(),
  z.object({ rule: z.literal('upgradeRewards') }).strict(),
]);

export const zRelic: z.ZodType<RelicDef> = z.object({
  id: z.string(), name: z.string(), tier: zRelicTier, faction: zColor.optional(), text: z.string(), flavor: z.string().optional(),
  triggers: z.array(zTrigger).optional(), modifiers: z.array(zModifier).optional(), onPickup: z.array(zRunEffect).optional(),
  run: z.array(zRunRule).optional(), counter: z.number().optional(), ruleChanging: z.boolean().optional(), art: zArt,
}).strict() as z.ZodType<RelicDef>;

export const zPotion: z.ZodType<PotionDef> = z.object({
  id: z.string(), name: z.string(), rarity: z.enum(['common', 'uncommon', 'rare']), text: z.string(), target: zTargetSpec,
  effects: z.array(zEffect), outOfCombat: z.array(zRunEffect).optional(), art: zArt,
}).strict() as z.ZodType<PotionDef>;

const zEventOption = z.object({
  text: z.string(), requires: zRunCondition.optional(), hint: z.string().optional(), effects: z.array(zRunEffect),
  outcome: z.string(), next: z.string().optional(),
}).strict();

export const zEvent: z.ZodType<EventDef> = z.object({
  id: z.string(), title: z.string(), acts: z.array(z.number()), requires: zRunCondition.optional(), text: z.string(),
  options: z.array(zEventOption).min(2),
  pages: z.array(z.object({ id: z.string(), text: z.string(), options: z.array(zEventOption).min(1) }).strict()).optional(),
  art: zArt,
}).strict() as z.ZodType<EventDef>;

export const zBlessing: z.ZodType<BlessingDef> = z.object({
  id: z.string(), name: z.string(), kind: z.enum(['trade', 'boon']), pack: z.number().int().min(0).max(3), text: z.string(), effects: z.array(zRunEffect).min(1),
}).strict() as z.ZodType<BlessingDef>;
