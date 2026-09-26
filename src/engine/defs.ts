/**
 * Data-definition types (the content DSL). Everything under src/data/*.json conforms to these,
 * validated by the zod schemas in ./schema.ts.
 */

export type Color = 'R' | 'B' | 'G' | 'Y' | 'P' | 'N';
export const COLORS: readonly Color[] = ['R', 'B', 'G', 'Y', 'P'];
export type Suit = 'sun' | 'thunder' | 'moon' | 'mountain';
export const SUITS: readonly Suit[] = ['sun', 'thunder', 'moon', 'mountain'];
export const YANG: readonly Suit[] = ['sun', 'thunder'];

export type CardType = 'unit' | 'tactic' | 'response' | 'equip' | 'delay' | 'field' | 'status' | 'curse';
export type Rarity = 'basic' | 'common' | 'rare' | 'epic' | 'legendary' | 'token' | 'special';

export type Keyword =
  | 'taunt' | 'ranged' | 'leap' | 'haste' | 'twinStrike' | 'ward' | 'lifesteal' | 'deathtouch' | 'thorns' | 'sunder'
  | 'battlecry' | 'deathrattle' | 'growth' | 'aura' | 'stealth'
  | 'response' | 'judge' | 'delay' | 'omen'
  | 'exhaust' | 'innate' | 'retain' | 'ethereal' | 'combo' | 'offering' | 'resonance';

export type StatusId =
  | 'burn' | 'poison' | 'freeze' | 'stun' | 'vulnerable' | 'weak' | 'silence'
  | 'might' | 'tenacity' | 'regen';

// ───────────── values ─────────────
export type CountKind =
  | 'hand' | 'drawPile' | 'discardPile' | 'exhaustPile'
  | 'sources' | 'readySources' | 'embers'
  | 'units' | 'cardsPlayed' | 'status' | 'armor' | 'atk' | 'hp' | 'missingHp' | 'maxHp'
  | 'signs' | 'judgeRank' | 'x' | 'lastDamage' | 'turn' | 'sacrificed' | 'eventAmount'
  | 'judgesThisTurn' | 'equipped' | 'delays' | 'counter' | 'deadThisCombat' | 'responsesThisCombat'
  | 'weaponAtk' | 'selected';

export type Value =
  | number
  | string // "$var"
  | { count: CountKind; color?: Color; side?: 'friendly' | 'enemy'; row?: 'front' | 'back'; status?: StatusId; of?: Selector; suit?: Suit | 'yang' | 'yin' }
  | { add: Value[] }
  | { mul: Value[] }
  | { sub: [Value, Value] }
  | { div: [Value, Value] }
  | { max: Value[] }
  | { min: Value[] };

// ───────────── selectors ─────────────
export type SelectorName =
  | 'self' | 'commander' | 'enemyCommander' | 'target' | 'it'
  | 'eventSource' | 'eventTarget' | 'declaredActor' | 'declaredTarget'
  | 'adjacent' | 'targetAdjacent'
  | 'allEnemies' | 'enemyUnits' | 'friendlyUnits' | 'allFriendly' | 'allUnits' | 'allCharacters'
  | 'randomEnemy' | 'randomEnemyUnit' | 'randomFriendlyUnit'
  | 'enemyFront' | 'enemyBack' | 'friendlyFront' | 'friendlyBack'
  | 'otherFriendlyUnits' | 'none';

export interface SelectorQuery {
  side: 'friendly' | 'enemy' | 'both';
  kind?: 'unit' | 'character' | 'commander';
  row?: 'front' | 'back';
  where?: Condition;
  pick?: 'all' | 'random' | 'lowestHp' | 'highestHp' | 'highestAtk' | 'lowestAtk' | 'first';
  n?: number;
  notSelf?: boolean;
}
export type Selector = SelectorName | SelectorQuery;

// ───────────── conditions ─────────────
export type Condition =
  | { gt: [Value, Value] } | { lt: [Value, Value] } | { gte: [Value, Value] } | { lte: [Value, Value] } | { eq: [Value, Value] }
  | { and: Condition[] } | { or: Condition[] } | { not: Condition }
  | { hasStatus: { of: Selector; status: StatusId } }
  | { hasKeyword: { of: Selector; keyword: Keyword } }
  | { isUnit: Selector } | { isCommander: Selector } | { alive: Selector }
  | { inRow: { of: Selector; row: 'front' | 'back' } }
  | { combo: number }
  | { resonance: { color: Color; n: number } }
  | { suit: Suit | 'yang' | 'yin' }
  | { rank: { min?: number; max?: number } }
  | { chance: number }
  | { inWindow: boolean }
  | { declared: IntentType }
  | { myTurn: boolean }
  | { eventCard: CardFilter }
  | { hasEquip: EquipSlot }
  | { emptySlot: { side: 'friendly' | 'enemy'; row?: 'front' | 'back' } };

export interface CardFilter {
  type?: CardType | CardType[];
  faction?: Color | Color[] | 'own';
  rarity?: Rarity | Rarity[];
  keyword?: Keyword;
  id?: string;
  maxCost?: number;
  minCost?: number;
}

// ───────────── effects ─────────────
export type JudgeBranches = {
  sun?: Effect[]; thunder?: Effect[]; moon?: Effect[]; mountain?: Effect[];
  yang?: Effect[]; yin?: Effect[];
  high?: Effect[]; // rank >= 8
  low?: Effect[]; // rank <= 7
  ranks?: { min: number; max: number; effects: Effect[] }[];
  always?: Effect[]; // after branch
};

export type EquipSlot = 'weapon' | 'armor' | 'mount' | 'treasure';

export type Effect =
  | { op: 'damage'; amount: Value; target: Selector; attack?: boolean; times?: Value; pierce?: boolean }
  | { op: 'attack'; attacker?: Selector; target: Selector; amount?: Value; times?: Value }
  | { op: 'heal'; amount: Value; target: Selector }
  | { op: 'loseHp'; amount: Value; target: Selector }
  | { op: 'armor'; amount: Value; target: Selector }
  /** give back a fraction of the armor that expired at the start of this turn (once per turn) */
  | { op: 'restoreArmor'; fraction: number; max?: number; target: Selector }
  | { op: 'ward'; amount: Value; target: Selector }
  | { op: 'status'; status: StatusId; amount: Value; target: Selector }
  | { op: 'cleanse'; target: Selector; what: 'debuffs' | 'buffs' | StatusId }
  | { op: 'buff'; target: Selector; atk?: Value; hp?: Value; until?: 'turn' }
  | { op: 'kill'; target: Selector }
  | { op: 'silence'; target: Selector }
  | { op: 'addKeyword'; target: Selector; keyword: Keyword; value?: Value }
  | { op: 'summon'; unit: string; n?: Value; row?: 'front' | 'back' | 'auto'; side?: 'friendly' | 'enemy'; atk?: Value; hp?: Value }
  | { op: 'move'; target: Selector; to: 'front' | 'back' | 'swap' }
  | { op: 'bounce'; target: Selector }
  | { op: 'transform'; target: Selector; into: string }
  | { op: 'draw'; n: Value }
  | { op: 'discard'; n: Value; mode: 'choose' | 'random' | 'all'; each?: Effect[] }
  | { op: 'exhaustCards'; n: Value; mode: 'choose' | 'random'; each?: Effect[] }
  | { op: 'create'; card: string | { pool: CardFilter }; n?: Value; to: 'hand' | 'draw' | 'discard'; upgraded?: boolean; fleeting?: boolean }
  | { op: 'discover'; pool: CardFilter; n?: number; upgraded?: boolean; free?: boolean }
  | { op: 'fetch'; from: 'draw' | 'discard' | 'exhaust'; mode: 'choose' | 'random' | 'top'; n: Value; filter?: CardFilter }
  | { op: 'energy'; n: Value; color?: Color }
  | { op: 'gainSource'; n: Value; color: Color | 'best' }
  | { op: 'emberCap'; n: Value }
  | { op: 'refresh'; n: Value }
  | { op: 'costMod'; scope: 'hand' | 'handRandom' | 'nextCard'; amount: Value; until: 'turn' | 'played' | 'combat'; filter?: CardFilter }
  | { op: 'judge'; branches: JudgeBranches; target?: Selector }
  | { op: 'peek'; n: Value }
  | { op: 'stargaze'; n: Value }
  | { op: 'sign'; n: Value }
  | { op: 'fateAdd'; suit: Suit; rank: number; n?: number; where: 'top' | 'shuffle' }
  | { op: 'delay'; card: string; target: Selector; turns?: Value }
  | { op: 'equip'; card: string; upgraded?: boolean }
  | { op: 'weapon'; atk?: Value; range?: Value; durability?: Value }
  | { op: 'destroyEquip'; slot: EquipSlot | 'random'; side: 'friendly' | 'enemy' }
  | { op: 'field'; card: string }
  | { op: 'cancel' }
  | { op: 'redirect'; to: Selector }
  | { op: 'repeat'; times: Value; effects: Effect[] }
  | { op: 'if'; cond: Condition; then: Effect[]; else?: Effect[] }
  | { op: 'choose'; options: { text: string; effects: Effect[] }[] }
  | { op: 'forEach'; sel: Selector; effects: Effect[] }
  | { op: 'store'; key: string; value: Value }
  | { op: 'counter'; amount: Value; max?: number; then?: Effect[] }
  | { op: 'gold'; n: Value }
  | { op: 'script'; id: string; args?: Record<string, unknown> };

// ───────────── triggers & modifiers ─────────────
export type TriggerOn =
  | 'combatStart' | 'combatEnd' | 'turnStart' | 'turnEnd' | 'opponentTurnStart' | 'opponentTurnEnd'
  | 'enter' | 'death'
  | 'cardPlayed' | 'cardSacrificed' | 'cardDrawn' | 'cardDiscarded' | 'cardExhausted' | 'cardCreated'
  | 'unitSummoned' | 'unitDied'
  | 'damaged' | 'dealtDamage' | 'attacked' | 'attacking' | 'healed' | 'armorGained' | 'armorBroken'
  | 'statusApplied' | 'judged' | 'rejudged' | 'responsePlayed' | 'actionDeclared' | 'equipped'
  | 'sourceGained' | 'shuffled';

export interface Trigger {
  on: TriggerOn;
  /** whose event: self = about this object; friendly/enemy = side-relative to owner; any */
  who?: 'self' | 'friendly' | 'enemy' | 'any';
  if?: Condition;
  effects: Effect[];
  limit?: 'turn' | 'combat';
  /** status id filter for statusApplied, suit for judged */
  status?: StatusId;
  suit?: Suit | 'yang' | 'yin';
  /** cardDiscarded: also react to the hand being cleared at the end of the turn (not a 弃置 otherwise) */
  endOfTurn?: boolean;
}

export type ModStat =
  | 'atk' | 'maxHp' | 'attackDamage' | 'damageTaken' | 'effectDamage' | 'burnDamage' | 'poisonDamage'
  | 'armorGain' | 'healing' | 'emberCap' | 'draw' | 'maxSources' | 'handLimit' | 'sacrifices'
  | 'range' | 'cost' | 'signCap' | 'keyword' | 'judgeRank' | 'burnKeep' | 'armorKeep' | 'retainHand';

export interface Modifier {
  stat: ModStat;
  amount?: Value;
  who?: 'self' | 'friendly' | 'enemy' | 'adjacent' | 'friendlyUnits' | 'enemyUnits' | 'commander' | 'all';
  keyword?: Keyword;
  filter?: CardFilter;
  if?: Condition;
}

// ───────────── card ─────────────
export interface Cost { g: number | 'X'; c?: Color[] }

export type TargetSpec =
  | 'none' | 'enemy' | 'enemyUnit' | 'friendlyUnit' | 'friendly' | 'anyUnit' | 'any' | 'enemyNoCommander';

export interface UnitStats {
  atk: number;
  hp: number;
  keywords?: Keyword[];
  thorns?: number;
  growth?: number;
  ward?: number;
  triggers?: Trigger[];
  aura?: Modifier[];
  modifiers?: Modifier[];
  /** units that prefer the back row when auto-placed */
  prefersBack?: boolean;
}

export interface EquipStats {
  slot: EquipSlot;
  atk?: number;
  range?: number;
  durability?: number;
  mount?: 'offense' | 'defense';
  triggers?: Trigger[];
  modifiers?: Modifier[];
}

export interface DelayStats {
  turns: number;
  on: 'enemy' | 'friendly' | 'any';
  branches: JudgeBranches;
}

export interface FieldStats {
  duration?: number;
  triggers?: Trigger[];
  modifiers?: Modifier[];
}

export interface ArtSpec {
  /** English subject description for image generation */
  subject: string;
  /** optional extra mood / composition hint */
  mood?: string;
}

export interface CardUpgrade {
  name?: string;
  text?: string;
  cost?: Cost;
  vars?: Record<string, number>;
  keywords?: Keyword[];
  effects?: Effect[];
  target?: TargetSpec;
  unit?: Partial<UnitStats>;
  equip?: Partial<EquipStats>;
  delay?: Partial<DelayStats>;
  field?: Partial<FieldStats>;
  onSacrifice?: Effect[];
  inHand?: Trigger[];
  windowOnly?: boolean;
  /** marks qualitative (mechanic-changing) upgrade, for the ≥1/3 rule */
  qualitative?: boolean;
}

export interface CardDef {
  id: string;
  name: string;
  faction: Color;
  type: CardType;
  rarity: Rarity;
  cost: Cost;
  text: string;
  flavor?: string;
  vars?: Record<string, number>;
  /** which vars are attack damage / armor / etc, for live-value coloring */
  varKinds?: Record<string, 'attack' | 'damage' | 'armor' | 'heal' | 'burn' | 'poison' | 'other'>;
  keywords?: Keyword[];
  target?: TargetSpec;
  effects?: Effect[];
  onSacrifice?: Effect[];
  /** triggers active while the card is in hand */
  inHand?: Trigger[];
  /** response cards: only playable inside a response window */
  windowOnly?: boolean;
  unit?: UnitStats;
  equip?: EquipStats;
  delay?: DelayStats;
  field?: FieldStats;
  unplayable?: boolean;
  upgrade?: CardUpgrade;
  art: ArtSpec;
  /** content pool control */
  pool?: boolean;
}

// ───────────── commanders ─────────────
export type SkillType = 'passive' | 'active' | 'limited' | 'awaken';
export interface SkillDef {
  id: string;
  name: string;
  type: SkillType;
  text: string;
  cost?: Cost;
  target?: TargetSpec;
  effects?: Effect[];
  triggers?: Trigger[];
  modifiers?: Modifier[];
  /** awaken: condition trigger; once met, `effects` run and `becomes` replaces this skill */
  awaken?: { on: TriggerOn; who?: Trigger['who']; if?: Condition; effects?: Effect[]; becomes?: Omit<SkillDef, 'awaken' | 'id'> & { id?: string } };
}

export interface CommanderDef {
  id: string;
  name: string;
  title: string;
  faction: Color;
  hp: number;
  sources: Color[];
  deck: string[];
  relic: string;
  skills: SkillDef[];
  /** 精通 rewards: a second starter relic (level 3) and 「另一面」, a skill that replaces one of the two (level 5) */
  alt?: { relic: string; replaces: string; skill: SkillDef };
  lore: string;
  ending: string;
  unlock?: string;
  art: ArtSpec;
}

/** 开局祈命: one of these is chosen at the start of a run (src/data/blessings.json) */
export interface BlessingDef {
  id: string;
  name: string;
  /** trade = a boon with a price; boon = a small pure boon (小吉) */
  kind: 'trade' | 'boon';
  /** unlock pack on the 命数 track (0 = from the start) */
  pack: number;
  text: string;
  effects: RunEffect[];
}

export interface LieutenantDef {
  id: string;
  name: string;
  title: string;
  faction: Color;
  skill: SkillDef;
  lore: string;
  art: ArtSpec;
}

// ───────────── enemies ─────────────
export type IntentType = 'attack' | 'defend' | 'buff' | 'debuff' | 'summon' | 'judge' | 'cast' | 'unknown' | 'escape' | 'sleep' | 'heal';
export type EnemyTargetRule = 'default' | 'commander' | 'randomUnit' | 'lowestHp' | 'highestAtk' | 'self' | 'ally' | 'allyLowest' | 'none';

export interface EnemyMove {
  name: string;
  intent: IntentType[];
  effects: Effect[];
  target?: EnemyTargetRule;
}

export type EnemyAI =
  | { type: 'cycle'; sequence: string[]; start?: 'random' | number }
  | { type: 'weighted'; weights: Record<string, number>; noRepeat?: number }
  | { type: 'script'; first?: string[]; rules?: { if: Condition; move: string; once?: boolean }[]; then: EnemyAI };

export interface EnemyPhase {
  hpBelow: number; // fraction
  /** phase only exists at this ascension or higher */
  minAscension?: number;
  name: string;
  text: string;
  ai: EnemyAI;
  moves?: Record<string, EnemyMove>;
  effects?: Effect[];
  art?: ArtSpec;
  atk?: number;
}

export interface EnemyDef {
  id: string;
  name: string;
  act: 1 | 2 | 3 | 4;
  tier: 'normal' | 'elite' | 'boss' | 'minion';
  hp: [number, number];
  atk: number;
  keywords?: Keyword[];
  thorns?: number;
  ward?: number;
  row: 'front' | 'back' | 'commander';
  moves: Record<string, EnemyMove>;
  ai: EnemyAI;
  passives?: Trigger[];
  modifiers?: Modifier[];
  phases?: EnemyPhase[];
  deck?: string[];
  energy?: { start: number; perTurn: number; max: number };
  lore: string;
  dialogue?: { intro?: string; phase?: string; defeat?: string };
  art: ArtSpec;
}

export interface EncounterDef {
  id: string;
  act: 1 | 2 | 3 | 4;
  tier: 'normal' | 'elite' | 'boss';
  pool?: 'easy' | 'hard';
  enemies: { id: string; row?: 'front' | 'back' | 'commander'; slot?: number }[];
  weight?: number;
  tutorial?: 'response' | 'judge';
}

// ───────────── relics / potions ─────────────
export type RelicTier = 'starter' | 'common' | 'uncommon' | 'rare' | 'boss' | 'shop' | 'event';
export interface RelicDef {
  id: string;
  name: string;
  tier: RelicTier;
  faction?: Color;
  text: string;
  flavor?: string;
  triggers?: Trigger[];
  modifiers?: Modifier[];
  /** run-level hooks */
  onPickup?: RunEffect[];
  run?: RunRule[];
  counter?: number;
  /** marks rule-changing relics (for the ≥20 requirement) */
  ruleChanging?: boolean;
  art: ArtSpec;
}

export type RunRule =
  | { rule: 'restHealBonus'; amount: number }
  | { rule: 'shopDiscount'; pct: number }
  | { rule: 'extraCardChoice'; n: number }
  | { rule: 'goldBonus'; pct: number }
  | { rule: 'noHealAtRest' }
  | { rule: 'potionSlots'; n: number }
  | { rule: 'eliteRelicExtra' }
  | { rule: 'mapReveal' }
  | { rule: 'removeCostDiscount'; pct: number }
  | { rule: 'upgradeRewards' };

export interface PotionDef {
  id: string;
  name: string;
  rarity: 'common' | 'uncommon' | 'rare';
  text: string;
  target: TargetSpec;
  effects: Effect[];
  /** usable on the map (outside combat) */
  outOfCombat?: RunEffect[];
  art: ArtSpec;
}

// ───────────── run-level effects (events etc.) ─────────────
export type RunEffect =
  | { op: 'gold'; n: number }
  | { op: 'hp'; n: number }
  | { op: 'hpPct'; pct: number }
  | { op: 'maxHp'; n: number }
  | { op: 'addCard'; card?: string; pool?: CardFilter; n?: number; upgraded?: boolean; choose?: number }
  | { op: 'removeCard'; n: number; mode: 'choose' | 'random'; filter?: CardFilter }
  | { op: 'upgradeCard'; n: number; mode: 'choose' | 'random' }
  | { op: 'transformCard'; n: number; mode: 'choose' | 'random' }
  | { op: 'duplicateCard'; n: number }
  | { op: 'addRelic'; relic?: string; tier?: RelicTier }
  | { op: 'loseRelic'; mode: 'random' | 'choose' }
  | { op: 'addPotion'; potion?: string }
  | { op: 'fight'; encounter: string; reward?: 'normal' | 'elite' | 'none' }
  | { op: 'fate'; action: 'remove' | 'add' | 'changeSuit' | 'preview'; suit?: Suit; rank?: number; n?: number }
  | { op: 'chance'; p: number; then: RunEffect[]; else?: RunEffect[] }
  | { op: 'lieutenant'; id?: string }
  | { op: 'flag'; key: string }
  | { op: 'emberCap'; n: number }
  | { op: 'startSource'; color: Color | 'own' };

export type RunCondition =
  | { gold: number } | { hpAbove: number } | { commander: string } | { lieutenant: string } | { faction: Color }
  | { hasRelic: string } | { flag: string } | { act: number } | { deckHas: CardFilter } | { noLieutenant: true };

export interface EventOption {
  text: string;
  requires?: RunCondition;
  hint?: string;
  effects: RunEffect[];
  outcome: string;
  next?: string;
}
export interface EventPage { id: string; text: string; options: EventOption[] }
export interface EventDef {
  id: string;
  title: string;
  acts: number[];
  requires?: RunCondition;
  text: string;
  options: EventOption[];
  pages?: EventPage[];
  art: ArtSpec;
}
