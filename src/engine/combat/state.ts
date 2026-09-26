import type { RngState } from '../rng';
import type { Color, Effect, EquipSlot, JudgeBranches, Keyword, StatusId, Suit, CardDef } from '../defs';

export type Side = 'player' | 'enemy';
export const other = (s: Side): Side => (s === 'player' ? 'enemy' : 'player');

export interface CardInst {
  uid: number;
  id: string;
  up: boolean;
  /** temporary cost delta; cleared per costModUntil */
  costMod?: number;
  costModUntil?: 'turn' | 'played' | 'combat';
  /** created with 浮光+燃尽 semantics */
  fleeting?: boolean;
  free?: boolean;
  /** response card kept in hand through the enemy turn */
  held?: boolean;
}

export interface FateCard { suit: Suit; rank: number; id: number; omen?: boolean }

export interface DelayInst { uid: number; card: string; up: boolean; turns: number; owner: Side }

export interface IntentState { move: string; target: number | null }

export interface AIState { history: string[]; fired: string[]; cycle: number }

export type Row = 'front' | 'back' | 'cmd';

export interface Unit {
  uid: number;
  side: Side;
  kind: 'commander' | 'unit';
  /** content id: card id (player units), enemy id, or commander id */
  def: string;
  origin: 'card' | 'enemy' | 'commander' | 'token';
  up: boolean;
  /** original card instance for bounce */
  card?: CardInst;
  name: string;
  row: Row;
  slot: number;
  baseAtk: number;
  baseMaxHp: number;
  hp: number;
  armor: number;
  /** armor that expired at this unit's last turn start (restoreArmor can give some back) */
  lostArmor?: number;
  atkBuff: number;
  hpBuff: number;
  tempAtk: number;
  ward: number;
  thorns: number;
  growth: number;
  statuses: Partial<Record<StatusId, number>>;
  extraKeywords: Keyword[];
  silenced: boolean;
  stealth: boolean;
  ts: number;
  enteredTurn: number;
  attacks: number;
  stunImmune: number;
  delays: DelayInst[];
  dead?: boolean;
  removed?: boolean;
  essential?: boolean;
  counter: number;
  // enemy data
  intent?: IntentState | null;
  ai?: AIState;
  phase?: number;
  pendingPhase?: number;
  /** statuses applied during the owner's own turn skip their first end-of-turn decay */
  fresh?: Partial<Record<StatusId, boolean>>;
}

export interface EquipInst { uid: number; card: string; up: boolean; durability: number; atkBonus: number; rangeBonus: number; ts: number }
export interface FieldInst { uid: number; card: string; up: boolean; turns: number | null; ts: number }

export interface SkillState { id: string; used: boolean; usedCombat: boolean; awakened: boolean; from: 'commander' | 'lieutenant' }
export interface RelicState { id: string; counter: number; disabled?: boolean }

export interface SideState {
  commander: number | null;
  front: (number | null)[];
  back: (number | null)[];
  equip: Partial<Record<EquipSlot, EquipInst>>;
  field: FieldInst | null;
  // enemy hand AI
  hand: CardInst[];
  deck: CardInst[];
  energy: number;
  signs: FateCard[];
}

export interface Source { color: Color; ready: boolean; temp?: boolean }

/** Execution context for a resolution unit */
export interface Ctx {
  side: Side;
  source: number | null;
  kind: 'card' | 'unit' | 'relic' | 'skill' | 'equip' | 'field' | 'move' | 'potion' | 'delay' | 'status' | 'system';
  card?: CardInst;
  defId?: string;
  up?: boolean;
  target: number | null;
  vars: Record<string, number>;
  x?: number;
  event?: { source: number | null; target: number | null; amount: number; card?: CardInst; suit?: Suit; status?: StatusId };
  declared?: { actor: number | null; target: number | null; link: number };
  judge?: FateCard;
  lastDamage?: number;
  it?: number | null;
  /** owner ref for counters */
  owner?: { kind: 'relic' | 'unit' | 'skill'; ref: number | string };
  inWindow?: boolean;
  selected?: number;
}

export type InternalEffect =
  | { op: '__it'; uid: number | null }
  | { op: '__evCard'; card: CardInst }
  | { op: '__judgeSet'; card: FateCard }
  | { op: '__judgeEnd'; card: FateCard; branch: string }
  | { op: '__summonCard'; slot: { row: 'front' | 'back'; slot: number } | null }
  | { op: '__equipCard' }
  | { op: '__attachDelay' }
  | { op: '__setField' }
  | { op: '__finishCard'; exhaust: boolean }
  | { op: '__move'; move: string }
  | { op: '__attack'; attacker: number; target: number }
  | { op: '__rejudgeCheck'; stage: number; branches: JudgeBranches; party: Side; card: FateCard; target: number | null };

export type AnyEffect = Effect | InternalEffect;

export type ChainLink =
  | { kind: 'card'; side: Side; card: CardInst; target: number | null; slot: { row: 'front' | 'back'; slot: number } | null; x: number; cancelled?: boolean; inWindow?: boolean }
  | { kind: 'move'; uid: number; move: string; target: number | null; cancelled?: boolean }
  | { kind: 'attack'; attacker: number; target: number; cancelled?: boolean }
  | { kind: 'skill'; side: Side; skill: number; target: number | null; cancelled?: boolean };

export type Task =
  | { k: 'fx'; effects: AnyEffect[]; i: number; ctx: Ctx }
  | { k: 'phase'; name: PhaseName }
  | { k: 'enemyAct'; uid: number }
  | { k: 'chain'; stage: 'window' | 'resolve' | 'after'; links: ChainLink[]; passes: number; origin: Side; resolvedBase?: ChainLink };

export type PhaseName =
  | 'combatStart' | 'playerTurnStart' | 'playerDraw' | 'playerTurnEnd' | 'playerCleanup' | 'enemyTurnStart' | 'enemyActions' | 'enemyTurnEnd';

export interface PendingTrigger { effects: Effect[]; ctx: Ctx; side: Side; ts: number; label: string }

export type Decision =
  | { kind: 'response'; actor: number | null; target: number | null; options: number[]; timer: number }
  | { kind: 'chooseCards'; from: 'hand' | 'draw' | 'discard' | 'exhaust' | 'offer'; cards: CardInst[]; min: number; max: number; purpose: 'discard' | 'exhaust' | 'fetch' | 'discover'; offer?: CardInst[] }
  | { kind: 'chooseOption'; options: string[] }
  | { kind: 'stargaze'; cards: FateCard[] }
  | { kind: 'rejudge'; card: FateCard; signs: FateCard[] };

export interface CombatConfig {
  commander: string;
  lieutenant?: string | null;
  hp: number;
  maxHp: number;
  deck: { id: string; up: boolean }[];
  relics: RelicState[];
  potions: (string | null)[];
  fateDeck: { suit: Suit; rank: number; omen?: boolean }[];
  encounter: string;
  ascension: number;
  seed: string;
  emberCapBonus?: number;
  extraStartSources?: Color[];
  /** 精通 「另一面」: the commander's alt skill replaces the one it names */
  altSkill?: boolean;
  /** first-act tutorial gating */
  tutorial?: { noResponse?: boolean; noJudge?: boolean };
}

export interface CombatState {
  v: 1;
  seed: string;
  rng: RngState;
  cfg: CombatConfig;
  turn: number;
  active: Side;
  phase: 'main' | 'busy' | 'over';
  over: null | 'win' | 'lose';
  nextUid: number;
  nextTs: number;
  units: Record<number, Unit>;
  sides: Record<Side, SideState>;
  draw: CardInst[];
  hand: CardInst[];
  discard: CardInst[];
  exhaust: CardInst[];
  sacrificed: CardInst[];
  limbo: CardInst[];
  sources: Source[];
  emberCap: number;
  sacrificesThisTurn: number;
  /** the active side has taken an action this turn (turn-start effects run before it) */
  acted?: boolean;
  cardsPlayedThisTurn: number;
  nextCardCostMod: number;
  fate: { deck: FateCard[]; discard: FateCard[]; known: number; signs: FateCard[] };
  skills: SkillState[];
  relics: RelicState[];
  potions: (string | null)[];
  tasks: Task[];
  triggers: PendingTrigger[];
  pending: Decision | null;
  /** extra continuation for a pending decision */
  pendingCtx: { task: number; effect: AnyEffect | null; data?: unknown } | null;
  triggerUse: Record<string, number>;
  stats: {
    judgesThisTurn: Partial<Record<Suit, number>>;
    dead: number;
    responses: number;
    damageDealt: number;
    damageTaken: number;
    cardsPlayed: number;
    turns: number;
  };
  goldGained: number;
  events: CEvent[];
  log: string[];
  /** action log for replays */
  actions: PlayerAction[];
  autoSkipResponse?: boolean;
  ending?: boolean;
}

// ───────────── player actions ─────────────
export type PlayerAction =
  | { type: 'play'; card: number; target?: number | null; slot?: { row: 'front' | 'back'; slot: number } | null }
  | { type: 'sacrifice'; card: number }
  | { type: 'attack'; attacker: number; target: number }
  | { type: 'skill'; skill: number; target?: number | null }
  | { type: 'potion'; slot: number; target?: number | null }
  | { type: 'endTurn' }
  | { type: 'respond'; card: number; target?: number | null }
  | { type: 'pass' }
  | { type: 'choose'; picks: number[] }
  | { type: 'arrange'; top: number[]; bottom: number[] }
  | { type: 'rejudge'; sign: number | null };

// ───────────── presentation events ─────────────
export interface UnitSnap {
  uid: number; side: Side; kind: 'commander' | 'unit'; def: string; name: string; row: Row; slot: number;
  atk: number; hp: number; maxHp: number; armor: number; ward: number; keywords: Keyword[]; up: boolean;
}

export type CEvent =
  | { t: 'turn'; side: Side; turn: number }
  | { t: 'draw'; card: CardInst }
  | { t: 'drawFail'; reason: 'empty' | 'handFull' }
  | { t: 'shuffle'; n: number }
  | { t: 'discard'; card: CardInst }
  | { t: 'exhaust'; card: CardInst }
  | { t: 'create'; card: CardInst; to: 'hand' | 'draw' | 'discard' }
  | { t: 'sacrifice'; card: CardInst; color: Color; gained: boolean }
  | { t: 'sources'; sources: Source[] }
  | { t: 'embers'; count: number }
  | { t: 'play'; side: Side; card: CardInst; target: number | null }
  | { t: 'cardDone'; card: CardInst; to: 'discard' | 'exhaust' | 'board' }
  | { t: 'summon'; unit: UnitSnap; fromCard: boolean }
  | { t: 'move'; uid: number; row: Row; slot: number }
  | { t: 'attack'; attacker: number; target: number }
  | { t: 'damage'; target: number; source: number | null; amount: number; hpLoss: number; armorLoss: number; warded: boolean; hp: number; armor: number; kind: 'attack' | 'effect' | 'burn' | 'poison' | 'thorns' | 'retaliate' | 'loss' }
  | { t: 'heal'; target: number; amount: number; hp: number }
  | { t: 'armor'; target: number; amount: number; armor: number }
  | { t: 'ward'; target: number; ward: number }
  | { t: 'status'; target: number; status: StatusId; delta: number; total: number }
  | { t: 'stats'; target: number; atk: number; hp: number; maxHp: number }
  | { t: 'keyword'; target: number; keyword: Keyword | StatusId | 'trigger' }
  | { t: 'death'; uid: number }
  | { t: 'intent'; uid: number; move: string | null; target: number | null }
  | { t: 'declare'; uid: number; move: string; target: number | null }
  | { t: 'window'; open: boolean; actor?: number | null }
  | { t: 'response'; side: Side; card: CardInst }
  | { t: 'cancel'; what: string }
  | { t: 'redirect'; to: number }
  | { t: 'judgeFlip'; card: FateCard; party: Side; target: number | null }
  | { t: 'rejudge'; old: FateCard; now: FateCard; side: Side }
  | { t: 'judgeResult'; card: FateCard; branch: string }
  | { t: 'fate'; action: 'peek' | 'arrange' | 'sign' | 'shuffle' | 'add'; n: number }
  | { t: 'delay'; target: number; card: string; turns: number }
  | { t: 'delayTick'; target: number; card: string; turns: number }
  | { t: 'equip'; side: Side; slot: EquipSlot; card: string | null }
  | { t: 'weapon'; side: Side; atk: number; range: number; durability: number }
  | { t: 'field'; side: Side; card: string | null }
  | { t: 'skill'; index: number }
  /** a passive skill (commander or lieutenant) triggered */
  | { t: 'passive'; index: number }
  | { t: 'relic'; id: string }
  | { t: 'phaseChange'; uid: number; phase: number; name: string; text: string }
  | { t: 'stunned'; uid: number }
  | { t: 'frozen'; uid: number }
  | { t: 'log'; text: string }
  | { t: 'end'; result: 'win' | 'lose' }
  | { t: 'potion'; slot: number; id: string };

export type ResolvedCard = CardDef;
export type { Effect };
