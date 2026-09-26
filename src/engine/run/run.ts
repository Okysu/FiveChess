/**
 * Run (adventure) layer: map traversal, node screens, rewards, shop, camp, events, recruit, stargazing.
 * Pure & deterministic — every random choice derives from the run seed + a label.
 */
import { content, matchCard } from '../content';
import type { CardFilter, Color, RelicTier, RunCondition, RunEffect, Suit, CardDef, RelicDef } from '../defs';
import { SUITS } from '../defs';
import { pick, rand, randInt, sample, seedRng, shuffle, weightedPick, type RngState } from '../rng';
import type { CombatConfig, CombatState, RelicState } from '../combat/state';
import { generateMap, nodeAt, reachable, type MapData, type MapNode, type NodeType } from './map';

export interface CardRef { uid: number; id: string; up: boolean }
export interface FateSpec { suit: Suit; rank: number; omen?: boolean }

export type RewardItem =
  | { k: 'gold'; n: number; taken?: boolean }
  | { k: 'cards'; options: CardRef[]; taken?: boolean }
  | { k: 'relic'; id: string; taken?: boolean }
  | { k: 'potion'; id: string; taken?: boolean };

export interface ShopState {
  cards: { card: CardRef; price: number; sold?: boolean }[];
  relics: { id: string; price: number; sold?: boolean }[];
  potions: { id: string; price: number; sold?: boolean }[];
  removePrice: number;
  removed?: boolean;
}

export type PickKind = 'remove' | 'upgrade' | 'transform' | 'duplicate';

export type Screen =
  | { k: 'map' }
  | { k: 'combat'; encounter: string; tier: 'normal' | 'elite' | 'boss'; seed: string; reward: 'normal' | 'elite' | 'boss' | 'none'; tutorial?: 'response' | 'judge' }
  | { k: 'reward'; items: RewardItem[]; elite?: boolean }
  | { k: 'bossRelic'; options: string[] }
  | { k: 'shop'; shop: ShopState }
  | { k: 'camp'; done: boolean }
  | { k: 'event'; id: string; page: string | null; outcome?: string }
  | { k: 'recruit'; options: string[]; done: boolean }
  | { k: 'stargaze'; done: boolean; preview?: { row: number; col: number; label: string }[]; mode?: 'remove' | 'change' | 'copy' }
  | { k: 'chest'; relic: string | null; gold: number; opened: boolean }
  | { k: 'pick'; kind: PickKind; n: number; optional: boolean; source: 'camp' | 'event' | 'shop' | 'relic'; filter?: CardFilter }
  | { k: 'cardChoice'; options: CardRef[]; n: number }
  | { k: 'actStart'; act: number }
  | { k: 'blessing'; options: string[] }
  | { k: 'victory' }
  | { k: 'hiddenChoice' }
  | { k: 'defeat' };

export interface RunOpts {
  seed: string;
  commander: string;
  ascension: number;
  tutorial?: boolean;
  locked?: { cards?: string[]; relics?: string[]; events?: string[]; lieutenants?: string[] };
  unlockedHidden?: boolean;
  /** 开局祈命: the unlocked 命签 and how many to offer (none → the run starts straight away) */
  blessings?: { pool: string[]; count: number };
  /** 精通 loadout: the second starter relic / 「另一面」 instead of the originals */
  altRelic?: boolean;
  altSkill?: boolean;
}

export interface RunState {
  v: 1;
  seed: string;
  ascension: number;
  tutorial: boolean;
  commander: string;
  lieutenant: string | null;
  hp: number;
  maxHp: number;
  gold: number;
  deck: CardRef[];
  relics: RelicState[];
  potions: (string | null)[];
  fateDeck: FateSpec[];
  act: number;
  floor: number;
  map: MapData;
  pos: { row: number; col: number } | null;
  bosses: Record<number, string>;
  screen: Screen;
  stack: Screen[];
  pending: RunEffect[];
  flags: string[];
  emberCapBonus: number;
  extraStartSources: Color[];
  seenEvents: string[];
  seenRelics: string[];
  relicBags: Partial<Record<RelicTier, string[]>>;
  previews: Record<string, string>;
  rarityOffset: number;
  potionChance: number;
  nextUid: number;
  locked: NonNullable<RunOpts['locked']>;
  unlockedHidden: boolean;
  stats: { floors: number; combats: number; elites: number; bosses: number; goldEarned: number; damageTaken: number; cardsPlayed: number; turns: number; maxDamage: number };
  history: { act: number; row: number; col?: number; type: NodeType | 'event-fight' | 'recruit'; detail: string }[];
  discovered: { cards: string[]; enemies: string[]; relics: string[] };
  log: RunAction[];
  result: null | 'win' | 'lose';
  nemesis?: string;
  /** the 命签 chosen at the start (null = skipped) */
  blessing?: string | null;
  /** 精通: this run uses the commander's 「另一面」 skill */
  altSkill?: boolean;
}

export type RunAction =
  | { t: 'go'; row: number; col: number }
  | { t: 'take'; i: number; choice?: number | null }
  | { t: 'proceed' }
  | { t: 'buy'; what: 'card' | 'relic' | 'potion'; i: number }
  | { t: 'removeService' }
  | { t: 'rest'; opt: 'heal' | 'upgrade' | 'remove' }
  | { t: 'pick'; uids: number[] }
  | { t: 'event'; i: number }
  | { t: 'recruit'; i: number | null }
  | { t: 'fate'; op: 'remove' | 'copy' | 'change' | 'preview'; idx?: number; suit?: Suit }
  | { t: 'open' }
  | { t: 'bossRelic'; i: number | null }
  | { t: 'discardPotion'; slot: number }
  | { t: 'mapPotion'; slot: number }
  | { t: 'hidden'; go: boolean }
  | { t: 'blessing'; i: number | null }
  | { t: 'combatResult'; result: 'win' | 'lose'; hp: number; gold: number; potions: (string | null)[]; relics: RelicState[]; stats: CombatState['stats']; enemies: string[] };

// ───────────── setup ─────────────

const rngFor = (r: RunState, label: string): RngState => seedRng(`${r.seed}/${label}`);
const HIDDEN_BOSS = 'enc4_nameless';

export function fullFateDeck(): FateSpec[] {
  return SUITS.flatMap((suit) => Array.from({ length: 13 }, (_, i) => ({ suit, rank: i + 1 })));
}

export function newRun(o: RunOpts): RunState {
  const c = content();
  const cmd = c.commander(o.commander);
  const starter = o.altRelic && cmd.alt && c.relics.has(cmd.alt.relic) ? cmd.alt.relic : cmd.relic;
  let maxHp = cmd.hp;
  if (o.ascension >= 6) maxHp = Math.round(maxHp * 0.9);
  const r: RunState = {
    v: 1, seed: o.seed, ascension: o.ascension, tutorial: !!o.tutorial, commander: cmd.id, lieutenant: null,
    hp: maxHp, maxHp, gold: 99, deck: [], relics: [{ id: starter, counter: 0 }], potions: [null, null, null],
    fateDeck: fullFateDeck(), act: 1, floor: 0, map: { act: 1, rows: [], boss: null, width: 7, height: 15 }, pos: null, bosses: {},
    screen: { k: 'actStart', act: 1 }, stack: [], pending: [], flags: [], emberCapBonus: 0, extraStartSources: [],
    seenEvents: [], seenRelics: [starter], relicBags: {}, previews: {}, rarityOffset: -5, potionChance: 40, nextUid: 1,
    locked: o.locked ?? {}, unlockedHidden: !!o.unlockedHidden,
    stats: { floors: 0, combats: 0, elites: 0, bosses: 0, goldEarned: 0, damageTaken: 0, cardsPlayed: 0, turns: 0, maxDamage: 0 },
    history: [], discovered: { cards: [], enemies: [], relics: [starter] }, log: [], result: null,
    altSkill: !!(o.altSkill && cmd.alt),
  };
  for (const id of cmd.deck) addCardToDeck(r, id, false);
  if (o.ascension >= 10 && c.cards.has('cu_suye')) addCardToDeck(r, 'cu_suye', false);
  if (o.ascension >= 13) for (let i = 0; i < 4; i++) r.fateDeck.push({ suit: 'thunder', rank: 13, omen: true });
  const rel = c.relic(starter);
  if (rel.onPickup) r.pending.push(...rel.onPickup);
  // choose the act bosses up-front
  for (const act of [1, 2, 3, 4]) {
    const bossEncs = [...c.encounters.values()].filter((e) => e.act === act && e.tier === 'boss' && !(act === 4 && e.enemies.some((x) => x.id.includes('nameless') || x.id.includes('wuming'))));
    const b = pick(rngFor(r, `boss:${act}`), bossEncs.sort((a, b2) => a.id.localeCompare(b2.id)));
    if (b) r.bosses[act] = b.id;
  }
  startAct(r, 1);
  // 开局祈命: offer N of the unlocked 命签 before the first map
  const pool = (o.blessings?.pool ?? []).filter((id) => c.blessings.has(id)).sort();
  if (!r.tutorial && pool.length && (o.blessings?.count ?? 0) > 0) {
    r.screen = { k: 'blessing', options: sample(rngFor(r, 'blessing'), pool, o.blessings!.count) };
  }
  return r;
}

function startAct(r: RunState, act: number) {
  r.act = act;
  r.pos = null;
  r.map = generateMap(`${r.seed}/map:${act}`, { act, hasLieutenant: !!r.lieutenant, tutorial: r.tutorial, ascension: r.ascension });
  r.map.boss = r.bosses[act] ?? null;
  r.screen = { k: 'actStart', act };
  if (hasRule(r, 'mapReveal').length) previewNodes(r, 99);
}

export function ownColors(r: RunState): Color[] {
  const c = content();
  const out: Color[] = [c.commander(r.commander).faction];
  if (r.lieutenant) { const l = c.lieutenants.get(r.lieutenant); if (l) out.push(l.faction); }
  return out;
}

export function addCardToDeck(r: RunState, id: string, up: boolean): CardRef {
  const ref = { uid: r.nextUid++, id, up };
  r.deck.push(ref);
  if (!r.discovered.cards.includes(id)) r.discovered.cards.push(id);
  return ref;
}

function hasRule<K extends string>(r: RunState, rule: K): { amount?: number; pct?: number; n?: number }[] {
  const out: { amount?: number; pct?: number; n?: number }[] = [];
  for (const rs of r.relics) for (const rr of content().relics.get(rs.id)?.run ?? []) if (rr.rule === rule) out.push(rr as never);
  return out;
}

// ───────────── combat hand-off ─────────────

export function combatConfig(r: RunState): CombatConfig {
  const sc = r.screen;
  if (sc.k !== 'combat') throw new Error('not in combat');
  return {
    commander: r.commander, lieutenant: r.lieutenant, hp: r.hp, maxHp: r.maxHp,
    deck: r.deck.map((d) => ({ id: d.id, up: d.up })), relics: r.relics.map((x) => ({ ...x })), potions: [...r.potions],
    fateDeck: r.fateDeck.map((f) => ({ ...f })), encounter: sc.encounter, ascension: r.ascension, seed: sc.seed,
    emberCapBonus: r.emberCapBonus, extraStartSources: [...r.extraStartSources], altSkill: !!r.altSkill,
  };
}

function enterCombat(r: RunState, encounter: string, tier: 'normal' | 'elite' | 'boss', reward: 'normal' | 'elite' | 'boss' | 'none') {
  const enc = content().encounters.get(encounter);
  r.screen = { k: 'combat', encounter, tier, seed: `${r.seed}/combat:${r.act}:${r.floor}:${encounter}`, reward, tutorial: r.tutorial ? enc?.tutorial : undefined };
}

function pickEventEncounter(r: RunState, rng: RngState, tier: 'normal' | 'elite'): string {
  const pool = [...content().encounters.values()]
    .filter((e) => e.act === Math.min(r.act, 3) && e.tier === tier && (e.weight ?? 1) > 0 && (tier === 'elite' || e.pool !== 'easy'))
    .sort((a, b) => a.id.localeCompare(b.id));
  return pick(rng, pool)?.id ?? pick(rng, [...content().encounters.values()].filter((e) => e.act === Math.min(r.act, 3) && e.tier === 'normal' && (e.weight ?? 1) > 0))!.id;
}

function pickEncounter(r: RunState, node: MapNode, tier: 'normal' | 'elite'): string {
  const key = `${r.act}:${node.row}:${node.col}`;
  if (r.previews[key]) return r.previews[key]!;
  const all = [...content().encounters.values()].filter((e) => e.act === r.act && e.tier === tier && (e.weight ?? 1) > 0).sort((a, b) => a.id.localeCompare(b.id));
  let pool = all;
  if (tier === 'normal') {
    const combatsThisAct = r.history.filter((h) => h.act === r.act && h.type === 'combat').length;
    const easy = all.filter((e) => e.pool === 'easy');
    const hard = all.filter((e) => e.pool !== 'easy');
    pool = combatsThisAct < 3 && easy.length ? easy : hard.length ? hard : all;
  }
  if (tier === 'elite' && r.tutorial && r.act === 1) {
    const tut = pool.filter((e) => e.tutorial === 'response');
    if (tut.length && !r.flags.includes('tut_response')) pool = tut;
  }
  const recent = r.history.slice(-3).map((h) => h.detail);
  const fresh = pool.filter((e) => !recent.includes(e.id));
  const id = pick(rngFor(r, `enc:${key}`), fresh.length ? fresh : pool)!.id;
  return id;
}

export function applyCombatResult(r: RunState, a: Extract<RunAction, { t: 'combatResult' }>) {
  const sc = r.screen;
  if (sc.k !== 'combat') return;
  r.stats.damageTaken += Math.max(0, r.hp - a.hp);
  r.stats.cardsPlayed += a.stats.cardsPlayed;
  r.stats.turns += a.stats.turns;
  r.stats.maxDamage = Math.max(r.stats.maxDamage, a.stats.damageDealt);
  r.hp = Math.max(0, a.hp);
  r.potions = [...a.potions];
  r.relics = a.relics.map((x) => ({ ...x }));
  for (const e of a.enemies) if (!r.discovered.enemies.includes(e)) r.discovered.enemies.push(e);
  if (a.result === 'lose' || r.hp <= 0) {
    // the hidden boss is an optional epilogue after a completed run: falling there still counts as a win
    if (r.flags.includes('hidden_boss')) { r.hp = Math.max(1, r.hp); r.flags.push('hidden_boss_lost'); r.result = 'win'; r.screen = { k: 'victory' }; return; }
    r.result = 'lose';
    r.nemesis = sc.encounter;
    r.screen = { k: 'defeat' };
    return;
  }
  r.stats.combats++;
  if (sc.tier === 'elite') r.stats.elites++;
  if (sc.tutorial === 'response') r.flags.push('tut_response');
  let gold = a.gold;
  const items: RewardItem[] = [];
  const rng = rngFor(r, `reward:${r.act}:${r.floor}`);
  if (sc.reward !== 'none') {
    const base = sc.reward === 'boss' ? randInt(rng, 95, 105) : sc.reward === 'elite' ? randInt(rng, 25, 35) : randInt(rng, 10, 20);
    gold += base;
  }
  const bonus = hasRule(r, 'goldBonus').reduce((s, x) => s + (x.pct ?? 0), 0);
  gold = Math.round(gold * (1 + bonus / 100));
  if (gold > 0) items.push({ k: 'gold', n: gold });
  if (sc.reward !== 'none') {
    items.push({ k: 'cards', options: rollCardReward(r, rng, sc.reward) });
    if (sc.reward === 'elite') {
      items.push({ k: 'relic', id: rollRelic(r, rng, rollRelicTier(rng)) });
      if (hasRule(r, 'eliteRelicExtra').length) items.push({ k: 'relic', id: rollRelic(r, rng, rollRelicTier(rng)) });
    }
    if (randInt(rng, 1, 100) <= r.potionChance) { const p = rollPotion(r, rng); if (p) items.push({ k: 'potion', id: p }); r.potionChance = Math.max(10, r.potionChance - 10); }
    else r.potionChance = Math.min(90, r.potionChance + 10);
  }
  if (sc.reward === 'boss') {
    r.stats.bosses++;
    r.stack.push({ k: 'bossRelic', options: [0, 1, 2].map(() => rollRelic(r, rng, 'boss')).filter((x, i, arr) => arr.indexOf(x) === i) });
  }
  r.screen = { k: 'reward', items, elite: sc.reward === 'elite' };
}

// ───────────── rolls ─────────────

function rarityFor(rng: RngState, kind: 'normal' | 'elite' | 'boss' | 'shop', offset: number): CardDef['rarity'] {
  if (kind === 'boss') return rand(rng) < 0.3 ? 'legendary' : 'epic';
  const roll = randInt(rng, 1, 100) + offset;
  const t = kind === 'elite' ? { legendary: 97, epic: 83, rare: 45 } : kind === 'shop' ? { legendary: 97, epic: 88, rare: 55 } : { legendary: 99, epic: 92, rare: 62 };
  if (roll >= t.legendary) return 'legendary';
  if (roll >= t.epic) return 'epic';
  if (roll >= t.rare) return 'rare';
  return 'common';
}

function cardPool(r: RunState, filter: CardFilter = {}): CardDef[] {
  const locked = new Set(r.locked.cards ?? []);
  const tutorialNoAdvanced = r.tutorial && r.act === 1 && !r.flags.includes('tut_response');
  return content().filterCards(filter, ownColors(r)).filter((c) => {
    if (locked.has(c.id)) return false;
    if (tutorialNoAdvanced && (c.type === 'response' || c.type === 'delay' || (c.keywords ?? []).includes('judge'))) return false;
    return true;
  });
}

export function rollCardReward(r: RunState, rng: RngState, kind: 'normal' | 'elite' | 'boss', n = 3): CardRef[] {
  const extra = hasRule(r, 'extraCardChoice').reduce((s, x) => s + (x.n ?? 0), 0);
  const own = ownColors(r);
  const out: CardRef[] = [];
  const upChance = hasRule(r, 'upgradeRewards').length ? 1 : (r.act - 1) * 0.15 * (r.ascension >= 12 ? 0.5 : 1);
  for (let i = 0; i < n + extra; i++) {
    const rarity = rarityFor(rng, kind, r.rarityOffset);
    if (rarity === 'common') r.rarityOffset = Math.min(40, r.rarityOffset + 1);
    else if (rarity !== 'rare') r.rarityOffset = -5;
    const fr = rand(rng);
    const faction: Color = r.lieutenant ? (fr < 0.55 ? own[0]! : fr < 0.87 ? own[1]! : 'N') : fr < 0.85 ? own[0]! : 'N';
    let pool = cardPool(r, { faction, rarity }).filter((c) => !out.some((o) => o.id === c.id));
    if (!pool.length) pool = cardPool(r, { faction: 'own', rarity }).filter((c) => !out.some((o) => o.id === c.id));
    if (!pool.length) pool = cardPool(r, {}).filter((c) => !out.some((o) => o.id === c.id));
    const d = pick(rng, pool);
    if (d) out.push({ uid: r.nextUid++, id: d.id, up: !!d.upgrade && rand(rng) < upChance });
  }
  return out;
}

function rollRelicTier(rng: RngState): RelicTier {
  const x = randInt(rng, 1, 100);
  return x <= 50 ? 'common' : x <= 83 ? 'uncommon' : 'rare';
}

export function rollRelic(r: RunState, rng: RngState, tier: RelicTier): string {
  const own = ownColors(r);
  const locked = new Set(r.locked.relics ?? []);
  const eligible = (x: RelicDef) => x.tier === tier && !locked.has(x.id) && !r.relics.some((h) => h.id === x.id) && (!x.faction || x.faction === 'N' || own.includes(x.faction));
  let bag = r.relicBags[tier];
  if (!bag || !bag.some((id) => eligible(content().relic(id)))) {
    bag = shuffle(rng, [...content().relics.values()].filter(eligible).map((x) => x.id).sort());
    r.relicBags[tier] = bag;
  }
  while (bag.length) {
    const id = bag.shift()!;
    if (eligible(content().relic(id))) return id;
  }
  const fallback = [...content().relics.values()].filter((x) => x.tier === 'common' && !r.relics.some((h) => h.id === x.id));
  return (pick(rng, fallback) ?? content().relic(r.relics[0]!.id)).id;
}

function rollPotion(r: RunState, rng: RngState): string | null {
  const all = [...content().potions.values()].sort((a, b) => a.id.localeCompare(b.id));
  const w = { common: 65, uncommon: 25, rare: 10 } as const;
  return weightedPick(rng, all, (p) => w[p.rarity])?.id ?? null;
}

// ───────────── relic gain ─────────────

export function gainRelic(r: RunState, id: string) {
  if (r.relics.some((x) => x.id === id)) return;
  r.relics.push({ id, counter: 0 });
  if (!r.seenRelics.includes(id)) r.seenRelics.push(id);
  if (!r.discovered.relics.includes(id)) r.discovered.relics.push(id);
  const def = content().relic(id);
  for (const rule of def.run ?? []) if (rule.rule === 'potionSlots') for (let i = 0; i < rule.n; i++) r.potions.push(null);
  if ((def.run ?? []).some((x) => x.rule === 'mapReveal') && r.map) previewNodes(r, 99);
  if (def.onPickup) r.pending.push(...def.onPickup);
}

function gainPotion(r: RunState, id: string): boolean {
  const i = r.potions.indexOf(null);
  if (i < 0) return false;
  r.potions[i] = id;
  return true;
}

// ───────────── run effects (events, relic pickups) ─────────────

export function checkCond(r: RunState, c: RunCondition): boolean {
  if ('gold' in c) return r.gold >= c.gold;
  if ('hpAbove' in c) return r.hp > c.hpAbove;
  if ('commander' in c) return r.commander === c.commander;
  if ('lieutenant' in c) return r.lieutenant === c.lieutenant;
  if ('faction' in c) return ownColors(r).includes(c.faction);
  if ('hasRelic' in c) return r.relics.some((x) => x.id === c.hasRelic);
  if ('flag' in c) return r.flags.includes(c.flag);
  if ('act' in c) return r.act === c.act;
  if ('deckHas' in c) return r.deck.some((d) => matchCard(content().card(d.id), c.deckHas, ownColors(r)));
  if ('noLieutenant' in c) return !r.lieutenant;
  return true;
}

/** process queued run effects until one needs a player choice */
function drainPending(r: RunState) {
  for (let guard = 0; guard < 100 && r.pending.length; guard++) {
    const e = r.pending.shift()!;
    const needsScreen = applyRunEffect(r, e);
    if (needsScreen) return;
  }
}

function applyRunEffect(r: RunState, e: RunEffect): boolean {
  const rng = rngFor(r, `fx:${r.floor}:${r.log.length}:${r.pending.length}`);
  switch (e.op) {
    case 'gold': r.gold = Math.max(0, r.gold + e.n); if (e.n > 0) r.stats.goldEarned += e.n; return false;
    case 'hp': r.hp = Math.max(1, Math.min(r.maxHp, r.hp + e.n)); return false;
    case 'hpPct': r.hp = Math.max(1, Math.min(r.maxHp, r.hp + Math.round(r.maxHp * e.pct / 100))); return false;
    case 'maxHp': r.maxHp = Math.max(1, r.maxHp + e.n); r.hp = Math.max(1, Math.min(r.maxHp, r.hp + Math.max(0, e.n))); return false;
    case 'addCard': {
      const n = e.n ?? 1;
      if (e.card) { for (let i = 0; i < n; i++) addCardToDeck(r, e.card, !!e.upgraded); return false; }
      const pool = e.pool ? (e.pool.type === 'curse' || e.pool.type === 'status' ? [...content().cards.values()].filter((c) => matchCard(c, e.pool!, ownColors(r))) : cardPool(r, e.pool)) : cardPool(r);
      if (e.choose) {
        const opts = sample(rng, pool, e.choose).map((d) => ({ uid: r.nextUid++, id: d.id, up: !!e.upgraded }));
        if (opts.length) { pushScreen(r, { k: 'cardChoice', options: opts, n }); return true; }
        return false;
      }
      for (let i = 0; i < n; i++) { const d = pick(rng, pool); if (d) addCardToDeck(r, d.id, !!e.upgraded); }
      return false;
    }
    case 'removeCard': case 'upgradeCard': case 'transformCard': case 'duplicateCard': {
      const kind: PickKind = e.op === 'removeCard' ? 'remove' : e.op === 'upgradeCard' ? 'upgrade' : e.op === 'transformCard' ? 'transform' : 'duplicate';
      const mode = 'mode' in e ? e.mode : 'choose';
      const filter = 'filter' in e ? e.filter : undefined;
      const candidates = pickCandidates(r, kind, filter);
      if (!candidates.length) return false;
      if (mode === 'random') {
        const picks = sample(rng, candidates, e.n);
        for (const c of picks) applyPick(r, kind, c.uid, rng);
        return false;
      }
      pushScreen(r, { k: 'pick', kind, n: Math.min(e.n, candidates.length), optional: false, source: 'event', filter });
      return true;
    }
    case 'addRelic': gainRelic(r, e.relic ?? rollRelic(r, rng, e.tier ?? rollRelicTier(rng))); return false;
    case 'loseRelic': {
      const cands = r.relics.filter((x) => content().relic(x.id).tier !== 'starter');
      const x = pick(rng, cands);
      if (x) r.relics.splice(r.relics.indexOf(x), 1);
      return false;
    }
    case 'addPotion': { const p = e.potion ?? rollPotion(r, rng); if (p) gainPotion(r, p); return false; }
    case 'fight': {
      r.stack.push({ k: 'map' });
      // "random:normal" / "random:elite": a fresh encounter from this act's pool (events aren't tied to one fight)
      const m = /^random:(normal|elite)$/.exec(e.encounter);
      const enc = m ? pickEventEncounter(r, rng, m[1] as 'normal' | 'elite') : e.encounter;
      enterCombat(r, enc, content().encounters.get(enc)?.tier ?? 'normal', e.reward ?? 'normal');
      return true;
    }
    case 'fate': return fateEffect(r, rng, e);
    case 'chance': r.pending.unshift(...(rand(rng) < e.p ? e.then : e.else ?? [])); return false;
    case 'lieutenant': {
      if (e.id) setLieutenant(r, e.id);
      else pushScreen(r, { k: 'recruit', options: rollLieutenants(r), done: false });
      return !e.id;
    }
    case 'flag': if (!r.flags.includes(e.key)) r.flags.push(e.key); return false;
    case 'emberCap': r.emberCapBonus += e.n; return false;
    case 'startSource': r.extraStartSources.push(e.color === 'own' ? content().commander(r.commander).faction : e.color); return false;
  }
}

function fateEffect(r: RunState, rng: RngState, e: Extract<RunEffect, { op: 'fate' }>): boolean {
  const n = e.n ?? 1;
  for (let k = 0; k < n; k++) {
    if (e.action === 'add') r.fateDeck.push({ suit: e.suit ?? pick(rng, SUITS)!, rank: e.rank ?? randInt(rng, 1, 13) });
    else if ((e.action === 'remove' || e.action === 'changeSuit') && !e.suit && !e.rank) {
      pushScreen(r, { k: 'stargaze', done: false, mode: e.action === 'remove' ? 'remove' : 'change' });
      return true;
    } else if (e.action === 'remove') {
      const cands = r.fateDeck.map((f, i) => ({ f, i })).filter((x) => (!e.suit || x.f.suit === e.suit) && (!e.rank || x.f.rank === e.rank));
      const x = pick(rng, cands);
      if (x && r.fateDeck.length > 20) r.fateDeck.splice(x.i, 1);
    } else if (e.action === 'changeSuit') {
      const cands = r.fateDeck.filter((f) => f.suit !== e.suit && !f.omen);
      const x = pick(rng, cands);
      if (x && e.suit) x.suit = e.suit;
    } else if (e.action === 'preview') {
      pushScreen(r, { k: 'stargaze', done: true, preview: previewNodes(r) });
      return true;
    }
  }
  return false;
}

function pushScreen(r: RunState, s: Screen) {
  r.stack.push(r.screen);
  r.screen = s;
}

function popScreen(r: RunState) {
  const prev = r.stack.pop();
  r.screen = prev ?? { k: 'map' };
  drainPending(r);
}

export function pickCandidates(r: RunState, kind: PickKind, filter?: CardFilter): CardRef[] {
  const base = kind === 'upgrade' ? r.deck.filter((d) => !d.up && !!content().card(d.id).upgrade)
    : kind === 'remove' || kind === 'transform' ? r.deck.filter((d) => content().card(d.id).rarity !== 'special' || content().card(d.id).type === 'curse' || content().card(d.id).type === 'status')
    : [...r.deck];
  return filter ? base.filter((d) => matchCard(content().card(d.id), filter, ownColors(r))) : base;
}

function applyPick(r: RunState, kind: PickKind, uid: number, rng: RngState) {
  const i = r.deck.findIndex((d) => d.uid === uid);
  if (i < 0) return;
  const d = r.deck[i]!;
  if (kind === 'remove') r.deck.splice(i, 1);
  else if (kind === 'upgrade') d.up = true;
  else if (kind === 'duplicate') addCardToDeck(r, d.id, d.up);
  else if (kind === 'transform') {
    const def = content().card(d.id);
    const pool = cardPool(r, { faction: def.faction === 'N' ? 'own' : def.faction }).filter((c) => c.id !== d.id);
    const nd = pick(rng, pool);
    r.deck.splice(i, 1);
    if (nd) addCardToDeck(r, nd.id, false);
  }
}

// ───────────── lieutenants ─────────────

export function rollLieutenants(r: RunState): string[] {
  const own = content().commander(r.commander).faction;
  const locked = new Set(r.locked.lieutenants ?? []);
  const cands = [...content().lieutenants.values()].filter((l) => l.faction !== own && !locked.has(l.id)).sort((a, b) => a.id.localeCompare(b.id));
  const rng = rngFor(r, `recruit:${r.act}:${r.floor}`);
  // prefer distinct colors
  const out: string[] = [];
  for (const l of shuffle(rng, [...cands])) {
    if (out.length >= 3) break;
    if (out.some((o) => content().lieutenants.get(o)!.faction === l.faction)) continue;
    out.push(l.id);
  }
  for (const l of cands) if (out.length < 3 && !out.includes(l.id)) out.push(l.id);
  return out;
}

export function setLieutenant(r: RunState, id: string) {
  r.lieutenant = id;
  r.history.push({ act: r.act, row: r.pos?.row ?? -1, type: 'recruit', detail: id });
}

// ───────────── stargaze preview ─────────────

export function previewNodes(r: RunState, rows = 3): { row: number; col: number; label: string }[] {
  const out: { row: number; col: number; label: string }[] = [];
  const startRow = (r.pos?.row ?? -1) + 1;
  for (const row of r.map.rows) for (const n of row) {
    if (n.row < startRow || n.row >= startRow + rows) continue;
    if (n.type === 'combat' || n.type === 'elite') {
      const enc = pickEncounter(r, n, n.type === 'combat' ? 'normal' : 'elite');
      r.previews[`${r.act}:${n.row}:${n.col}`] = enc;
      const names = content().encounters.get(enc)?.enemies.map((e) => content().enemies.get(e.id)?.name ?? e.id) ?? [];
      out.push({ row: n.row, col: n.col, label: names.join('、') });
    } else if (n.type === 'event') {
      const ev = pickEvent(r, n);
      if (ev) { r.previews[`${r.act}:${n.row}:${n.col}`] = ev; out.push({ row: n.row, col: n.col, label: content().events.get(ev)?.title ?? '' }); }
    }
  }
  return out;
}

function pickEvent(r: RunState, n: MapNode): string | null {
  const key = `${r.act}:${n.row}:${n.col}`;
  if (r.previews[key]) return r.previews[key]!;
  const locked = new Set(r.locked.events ?? []);
  const pool = [...content().events.values()].filter((e) => e.acts.includes(r.act) && !r.seenEvents.includes(e.id) && !locked.has(e.id) && (!e.requires || checkCond(r, e.requires))).sort((a, b) => a.id.localeCompare(b.id));
  // commander-specific events are weighted up
  const ev = weightedPick(rngFor(r, `event:${key}`), pool, (e) => (e.requires && 'commander' in e.requires ? 4 : 1));
  return ev?.id ?? null;
}

// ───────────── shop ─────────────

export function makeShop(r: RunState): ShopState {
  const rng = rngFor(r, `shop:${r.act}:${r.floor}`);
  const disc = hasRule(r, 'shopDiscount').reduce((s, x) => s + (x.pct ?? 0), 0);
  const asc = r.ascension >= 9 ? 1.1 : 1;
  const price = (base: number) => Math.round(base * asc * (1 - disc / 100) * (0.9 + rand(rng) * 0.2));
  const cardPrice = { basic: 30, common: 50, rare: 75, epic: 140, legendary: 220, token: 30, special: 60 } as const;
  const cards: ShopState['cards'] = [];
  const classCards = rollCardReward(r, rng, 'normal', 5).map((c) => ({ ...c, up: false }));
  const neutral = sample(rng, cardPool(r, { faction: 'N' }), 2).map((d) => ({ uid: r.nextUid++, id: d.id, up: false }));
  for (const c of [...classCards, ...neutral]) cards.push({ card: c, price: price(cardPrice[content().card(c.id).rarity]) });
  const sale = randInt(rng, 0, Math.max(0, classCards.length - 1));
  if (cards[sale]) cards[sale]!.price = Math.round(cards[sale]!.price / 2);
  const relicPrice = { starter: 100, common: 150, uncommon: 240, rare: 300, boss: 400, shop: 180, event: 200 } as const;
  const tiers: RelicTier[] = [rollRelicTier(rng), rollRelicTier(rng), 'shop'];
  const relics = tiers.map((t) => { const id = rollRelic(r, rng, t); return { id, price: price(relicPrice[content().relic(id).tier]) }; })
    .filter((x, i, arr) => arr.findIndex((y) => y.id === x.id) === i);
  const potions = [0, 1, 2].map(() => rollPotion(r, rng)).filter((x): x is string => !!x).map((id) => ({ id, price: price({ common: 50, uncommon: 75, rare: 100 }[content().potions.get(id)!.rarity]) }));
  const removeDisc = hasRule(r, 'removeCostDiscount').reduce((s, x) => s + (x.pct ?? 0), 0);
  const removes = r.flags.filter((f) => f === 'removed').length;
  return { cards, relics, potions, removePrice: Math.round((75 + 25 * removes) * (1 - removeDisc / 100)) };
}

// ───────────── node entry ─────────────

function enterNode(r: RunState, n: MapNode) {
  r.pos = { row: n.row, col: n.col };
  r.floor++;
  r.stats.floors++;
  const detail: string[] = [];
  switch (n.type) {
    case 'combat': { const e = pickEncounter(r, n, 'normal'); detail.push(e); enterCombat(r, e, 'normal', 'normal'); break; }
    case 'elite': { const e = pickEncounter(r, n, 'elite'); detail.push(e); enterCombat(r, e, 'elite', 'elite'); break; }
    case 'boss': { const e = r.bosses[r.act]!; detail.push(e); enterCombat(r, e, 'boss', 'boss'); break; }
    case 'event': {
      const ev = pickEvent(r, n);
      if (!ev) { const e = pickEncounter(r, n, 'normal'); enterCombat(r, e, 'normal', 'normal'); break; }
      r.seenEvents.push(ev);
      detail.push(ev);
      r.screen = { k: 'event', id: ev, page: null };
      break;
    }
    case 'shop': r.screen = { k: 'shop', shop: makeShop(r) }; break;
    case 'camp': r.screen = { k: 'camp', done: false }; break;
    case 'chest': {
      const rng = rngFor(r, `chest:${r.act}:${r.floor}`);
      r.screen = { k: 'chest', relic: rollRelic(r, rng, rollRelicTier(rng)), gold: randInt(rng, 25, 60), opened: false };
      break;
    }
    case 'recruit': r.screen = r.lieutenant ? { k: 'recruit', options: [], done: false } : { k: 'recruit', options: rollLieutenants(r), done: false }; break;
    case 'stargaze': r.screen = { k: 'stargaze', done: false }; break;
  }
  r.history.push({ act: r.act, row: n.row, col: n.col, type: n.type, detail: detail.join(',') });
}

/** after the last row, the boss node */
export function bossNode(r: RunState): MapNode {
  return { row: r.act === 4 ? 2 : 15, col: 3, type: 'boss', next: [], x: 0.5, y: 0 };
}

export function availableNodes(r: RunState): MapNode[] {
  if (r.screen.k !== 'map') return [];
  if (r.act !== 4 && r.pos && r.pos.row === r.map.rows.length - 1) return [bossNode(r)];
  return reachable(r.map, r.pos);
}

// ───────────── actions ─────────────

export function runAct(r: RunState, a: RunAction): string | null {
  const err = applyRun(r, a);
  if (!err) { r.log.push(a); drainPending(r); }
  return err;
}

function leaveToMap(r: RunState) {
  if (r.stack.length) { popScreen(r); return; }
  r.screen = { k: 'map' };
}

function applyRun(r: RunState, a: RunAction): string | null {
  const sc = r.screen;
  switch (a.t) {
    case 'go': {
      if (sc.k === 'actStart') { r.screen = { k: 'map' }; }
      if (r.screen.k !== 'map') return 'not on map';
      const opts = availableNodes(r);
      const n = opts.find((x) => x.row === a.row && x.col === a.col);
      if (!n) return 'unreachable';
      if (n.type === 'boss') { r.pos = { row: n.row, col: n.col }; r.floor++; enterCombat(r, r.bosses[r.act]!, 'boss', 'boss'); r.history.push({ act: r.act, row: n.row, col: n.col, type: 'boss', detail: r.bosses[r.act]! }); return null; }
      enterNode(r, n);
      return null;
    }
    case 'combatResult': applyCombatResult(r, a); return null;
    case 'take': {
      if (sc.k !== 'reward') return 'no reward';
      const it = sc.items[a.i];
      if (!it || it.taken) return 'bad item';
      if (it.k === 'gold') { r.gold += it.n; r.stats.goldEarned += it.n; }
      if (it.k === 'relic') gainRelic(r, it.id);
      if (it.k === 'potion') { if (!gainPotion(r, it.id)) return 'potion slots full'; }
      if (it.k === 'cards') {
        if (a.choice === null || a.choice === undefined) { it.taken = true; return null; }
        const c = it.options[a.choice];
        if (!c) return 'bad choice';
        addCardToDeck(r, c.id, c.up);
      }
      it.taken = true;
      return null;
    }
    case 'proceed': {
      if (sc.k === 'actStart') { r.screen = { k: 'map' }; return null; }
      if (sc.k === 'reward') {
        if (r.flags.includes('hidden_boss')) { r.stats.bosses++; r.result = 'win'; r.screen = { k: 'victory' }; return null; }
        const bossPending = r.stack.length && r.stack[r.stack.length - 1]!.k === 'bossRelic';
        if (bossPending) { r.screen = r.stack.pop()!; return null; }
        if (r.act >= 1 && sc.items && r.screen.k === 'reward' && lastWasBoss(r)) { advanceAct(r); return null; }
        leaveToMap(r);
        return null;
      }
      if (sc.k === 'bossRelic') { advanceAct(r); return null; }
      if (sc.k === 'event' && sc.outcome !== undefined) { leaveToMap(r); return null; }
      if (sc.k === 'event') return 'choose an option';
      if (sc.k === 'pick') { if (!sc.optional) return 'must pick'; popScreen(r); return null; }
      if (sc.k === 'cardChoice') { popScreen(r); return null; }
      leaveToMap(r);
      return null;
    }
    case 'blessing': {
      if (sc.k !== 'blessing') return 'no blessing';
      const id = a.i === null ? null : sc.options[a.i];
      if (a.i !== null && !id) return 'bad option';
      r.blessing = id;
      r.screen = { k: 'actStart', act: r.act };
      if (id) r.pending.push(...content().blessings.get(id)!.effects);
      return null;
    }
    case 'bossRelic': {
      if (sc.k !== 'bossRelic') return 'no boss relic';
      if (a.i !== null) { const id = sc.options[a.i]; if (!id) return 'bad'; gainRelic(r, id); }
      advanceAct(r);
      return null;
    }
    case 'buy': {
      if (sc.k !== 'shop') return 'not in shop';
      const list = a.what === 'card' ? sc.shop.cards : a.what === 'relic' ? sc.shop.relics : sc.shop.potions;
      const it = list[a.i];
      if (!it || it.sold) return 'sold';
      if (r.gold < it.price) return 'not enough gold';
      if (a.what === 'potion' && !r.potions.includes(null)) return 'potion slots full';
      r.gold -= it.price;
      it.sold = true;
      if (a.what === 'card') { const c = (it as ShopState['cards'][number]).card; addCardToDeck(r, c.id, c.up); }
      if (a.what === 'relic') gainRelic(r, (it as ShopState['relics'][number]).id);
      if (a.what === 'potion') gainPotion(r, (it as ShopState['potions'][number]).id);
      return null;
    }
    case 'removeService': {
      if (sc.k !== 'shop' || sc.shop.removed) return 'unavailable';
      if (r.gold < sc.shop.removePrice) return 'not enough gold';
      r.gold -= sc.shop.removePrice;
      sc.shop.removed = true;
      r.flags.push('removed');
      pushScreen(r, { k: 'pick', kind: 'remove', n: 1, optional: false, source: 'shop' });
      return null;
    }
    case 'rest': {
      if (sc.k !== 'camp' || sc.done) return 'unavailable';
      if (a.opt === 'heal') {
        if (hasRule(r, 'noHealAtRest').length) return 'cannot heal';
        const bonus = hasRule(r, 'restHealBonus').reduce((s, x) => s + (x.amount ?? 0), 0);
        r.hp = Math.min(r.maxHp, r.hp + Math.round(r.maxHp * 0.3) + bonus);
        sc.done = true;
        return null;
      }
      if (!pickCandidates(r, a.opt === 'upgrade' ? 'upgrade' : 'remove').length) return 'nothing to pick';
      sc.done = true;
      pushScreen(r, { k: 'pick', kind: a.opt === 'upgrade' ? 'upgrade' : 'remove', n: 1, optional: false, source: 'camp' });
      return null;
    }
    case 'pick': {
      if (sc.k === 'cardChoice') {
        const chosen = a.uids.map((u) => sc.options.find((o) => o.uid === u)).filter(Boolean) as CardRef[];
        if (chosen.length > sc.n) return 'too many';
        for (const c of chosen) addCardToDeck(r, c.id, c.up);
        popScreen(r);
        return null;
      }
      if (sc.k !== 'pick') return 'nothing to pick';
      const cands = pickCandidates(r, sc.kind, sc.filter);
      const uids = a.uids.filter((u) => cands.some((c) => c.uid === u));
      if (uids.length !== sc.n) return `pick exactly ${sc.n}`;
      const rng = rngFor(r, `pick:${r.floor}:${r.log.length}`);
      for (const u of uids) applyPick(r, sc.kind, u, rng);
      popScreen(r);
      return null;
    }
    case 'event': {
      if (sc.k !== 'event' || sc.outcome !== undefined) return 'no event';
      const ev = content().events.get(sc.id);
      if (!ev) return 'bad event';
      const opts = sc.page ? ev.pages?.find((p) => p.id === sc.page)?.options ?? [] : ev.options;
      const o = opts[a.i];
      if (!o) return 'bad option';
      if (o.requires && !checkCond(r, o.requires)) return 'requirement not met';
      if (o.next) { sc.page = o.next; r.pending.push(...o.effects); return null; }
      sc.outcome = o.outcome;
      r.pending.push(...o.effects);
      return null;
    }
    case 'recruit': {
      if (sc.k !== 'recruit' || sc.done) return 'no recruit';
      sc.done = true;
      if (a.i === null) { if (r.lieutenant) r.gold += 50; return null; }
      const id = sc.options[a.i];
      if (!id) return 'bad';
      setLieutenant(r, id);
      return null;
    }
    case 'fate': {
      if (sc.k !== 'stargaze' || sc.done) return 'no stargaze';
      if (sc.mode && a.op !== sc.mode) return 'not allowed here';
      if (a.op === 'preview') { sc.preview = previewNodes(r); sc.done = true; return null; }
      const f = r.fateDeck[a.idx ?? -1];
      if (!f) return 'bad fate card';
      if (a.op === 'remove') { if (r.fateDeck.length <= 20) return 'fate deck too small'; r.fateDeck.splice(a.idx!, 1); }
      if (a.op === 'copy') r.fateDeck.push({ ...f, omen: undefined });
      if (a.op === 'change') { if (!a.suit || f.omen) return 'bad suit'; f.suit = a.suit; }
      sc.done = true;
      return null;
    }
    case 'open': {
      if (sc.k !== 'chest' || sc.opened) return 'no chest';
      sc.opened = true;
      r.gold += sc.gold;
      if (sc.relic) gainRelic(r, sc.relic);
      return null;
    }
    case 'discardPotion': { if (r.potions[a.slot]) r.potions[a.slot] = null; return null; }
    case 'mapPotion': {
      const id = r.potions[a.slot];
      const def = id ? content().potions.get(id) : undefined;
      if (!def?.outOfCombat) return 'not usable here';
      r.potions[a.slot] = null;
      r.pending.push(...def.outOfCombat);
      return null;
    }
    case 'hidden': {
      if (sc.k !== 'hiddenChoice') return 'no choice';
      if (!a.go) { r.result = 'win'; r.screen = { k: 'victory' }; return null; }
      const hidden = content().encounters.get(HIDDEN_BOSS) ?? [...content().encounters.values()].find((e) => e.act === 4 && e.tier === 'boss' && e.id !== r.bosses[4]);
      if (!hidden) { r.result = 'win'; r.screen = { k: 'victory' }; return null; }
      r.flags.push('hidden_boss');
      enterCombat(r, hidden.id, 'boss', 'none');
      return null;
    }
  }
  return 'unknown action';
}

function lastWasBoss(r: RunState): boolean {
  const h = r.history[r.history.length - 1];
  return !!h && h.type === 'boss' && r.screen.k === 'reward' && !r.flags.includes(`bossdone:${r.act}`);
}

function advanceAct(r: RunState) {
  r.flags.push(`bossdone:${r.act}`);
  if (r.act >= 4 || r.flags.includes('hidden_boss')) {
    if (r.act === 4 && r.unlockedHidden && !r.flags.includes('hidden_boss')) { r.screen = { k: 'hiddenChoice' }; return; }
    r.result = 'win';
    r.screen = { k: 'victory' };
    return;
  }
  // heal after boss
  const missing = r.maxHp - r.hp;
  r.hp += r.ascension >= 5 ? Math.round(missing * 0.75) : missing;
  startAct(r, r.act + 1);
}


export { nodeAt };
export type { MapNode, NodeType };
