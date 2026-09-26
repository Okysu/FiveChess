/**
 * The balance simulator's play policy, importable: the combat driver (greedy autoplay bot turn loop) and the
 * run-layer heuristics (map / reward / shop / camp / event choices). scripts/simulate.ts drives it for balance
 * reports; scripts/export-parity.ts drives it through an instrumented SimIO to record parity traces for the
 * Godot port (godot/engine/sim/sim_policy.gd mirrors this file).
 *
 * Every engine call goes through `io` so a caller can observe each successful action; `defaultIO` is the plain
 * engine. Stats collection lives in the caller (SimHooks) and never influences a decision.
 */
import { createCombat, act, type ActResult } from '../src/engine/combat/api';
import { playTurn as enginePlayTurn, autoAnswer, chooseAction, legalActions, aiErrors } from '../src/engine/combat/autoplay';
import { runAct, combatConfig, availableNodes, pickCandidates, type RunState, type RunAction, type RewardItem } from '../src/engine/run/run';
import { content } from '../src/engine/content';
import { commanderOf } from '../src/engine/combat/board';
import type { CombatConfig, CombatState, PlayerAction } from '../src/engine/combat/state';

/** why the driver sent an action (the Godot parity harness recomputes the bot's choice per tag) */
export type ActSrc =
  | 'answer' // simulator answerAll: autoAnswer
  | 'pass' // simulator answerAll fallback after a rejected answer
  | 'settle' // autoplay playTurn/settle: autoAnswer
  | 'choose' // autoplay chooseAction
  | 'aiError' // autoplay playTurn: endTurn after a rejected bot action
  | 'end'; // simulator fight loop: forced endTurn when the bot stalled on the same turn

export interface SimIO {
  createCombat(cfg: CombatConfig): CombatState;
  combatAct(s: CombatState, a: PlayerAction, src: ActSrc): ActResult;
  /** one whole bot turn (autoplay.playTurn semantics) */
  playTurn(s: CombatState, io: SimIO): void;
  runAct(r: RunState, a: RunAction): string | null;
  /** the reward screen's potion is skipped when all slots are full (direct state edit, no run action) */
  markTaken(r: RunState, i: number): void;
  /** the fight hit the turn cap */
  forceLose(s: CombatState): void;
}

export const defaultIO: SimIO = {
  createCombat,
  combatAct: (s, a) => act(s, a),
  playTurn: (s) => enginePlayTurn(s),
  runAct,
  markTaken: (r, i) => { if (r.screen.k === 'reward') (r.screen.items[i] as RewardItem).taken = true; },
  forceLose: (s) => { s.over = 'lose'; },
};

/**
 * autoplay.playTurn written against SimIO so every action is observable. Same calls in the same order as
 * src/engine/combat/autoplay.ts playTurn + settle (scripts/export-parity.ts verifies both paths end identical).
 */
export function playTurnVia(s: CombatState, io: SimIO, maxActions = 30): void {
  const settle = () => { for (let i = 0; i < 20 && s.pending; i++) io.combatAct(s, autoAnswer(s), 'settle'); };
  for (let i = 0; i < maxActions && !s.over; i++) {
    settle();
    if (s.over || s.phase !== 'main') break;
    const a = chooseAction(s);
    const r = io.combatAct(s, a, 'choose');
    if (!r.ok) { if (aiErrors.length < 50) aiErrors.push(`${a.type}: ${r.error}`); io.combatAct(s, { type: 'endTurn' }, 'aiError'); break; }
    if (a.type === 'endTurn') break;
  }
  settle();
}

export interface SimHooks {
  /** 开局祈命: index of the 命签 to take (null = skip); default the first offered */
  blessing?: (options: string[]) => number | null;
  /** simulator --trace=<floor> / --debug */
  traceFloor?: number;
  debug?: boolean;
  onStall?(): void;
  onFightEnd?(info: { r: RunState; s: CombatState; encId: string; hp0: number; guard: number }): void;
  onCardOffer?(options: { id: string }[], picked: string | null): void;
}

export function score(id: string): number {
  const d = content().card(id);
  return { basic: 0, common: 1, rare: 2, epic: 3, legendary: 4, token: 0, special: 0 }[d.rarity] + (d.type === 'unit' ? 0.3 : 0);
}

/** answer pending decisions; an answer the engine rejects falls back to "pass" so a bad AI answer can't hang the fight */
export function answerAll(s: CombatState, io: SimIO = defaultIO, hooks: SimHooks = {}) {
  for (let i = 0; i < 20 && s.pending; i++) {
    if (io.combatAct(s, autoAnswer(s), 'answer').ok) continue;
    if (!io.combatAct(s, { type: 'pass' }, 'pass').ok) { hooks.onStall?.(); break; }
  }
}

/** bot turns until the combat ends or the 60-turn cap; returns the loop guard */
export interface FightTrace { before(s: CombatState): void; after(s: CombatState, a0: number): void }

export function fightLoop(s: CombatState, io: SimIO = defaultIO, hooks: SimHooks = {}, trace?: FightTrace): number {
  let guard = 0;
  while (!s.over && guard++ < 60) {
    answerAll(s, io, hooks);
    if (s.over) break;
    const a0 = s.actions.length;
    trace?.before(s);
    // playTurn ends the turn itself; only force an end if the AI got stuck on the same turn
    const turn = s.turn;
    io.playTurn(s, io);
    answerAll(s, io, hooks);
    if (s.phase === 'main' && !s.over && s.turn === turn) io.combatAct(s, { type: 'endTurn' }, 'end');
    trace?.after(s, a0);
  }
  if (!s.over) io.forceLose(s);
  return guard;
}

export function fight(r: RunState, io: SimIO = defaultIO, hooks: SimHooks = {}): boolean {
  const c = content();
  const s: CombatState = io.createCombat(combatConfig(r));
  const encId = r.screen.k === 'combat' ? r.screen.encounter : '?';
  const hp0 = r.hp;
  // --trace=<floor>: print the bot's decisions for the fight on that floor (debugging the AI)
  const tracing = hooks.traceFloor !== undefined && hooks.traceFloor === r.floor;
  const nm = (uid: number | null | undefined) => { const u = uid == null ? undefined : s.units[uid]; return u ? `${u.name}${u.hp}` : String(uid); };
  if (tracing) console.log(`TRACE ${encId} deck: ${r.deck.map((d) => c.card(d.id).name + (d.up ? '+' : '')).join(' ')}`);
  const trace: FightTrace | undefined = tracing ? {
    before: (st) => {
      const pc0 = commanderOf(st, 'player');
      if (hooks.debug) { console.log('   dbg phase', st.phase, 'pending', st.pending?.kind, 'tasks', st.tasks.length, 'legal', legalActions(st).length, JSON.stringify(chooseAction(st))); }
      console.log(`T${st.turn} hp ${pc0?.hp}+${pc0?.armor} src ${st.sources.length} hand [${st.hand.map((h) => c.card(h.id).name).join(' ')}] foes ${Object.values(st.units).filter((u) => u.side === 'enemy' && u.hp > 0).map((u) => `${u.name}${u.hp}+${u.armor}`).join(' ')}`);
    },
    after: (st, a0) => {
      for (const a of st.actions.slice(a0)) {
        const card = 'card' in a && typeof a.card === 'number' ? [...st.hand, ...st.discard, ...st.draw, ...st.exhaust, ...st.sacrificed, ...st.limbo].find((x) => x.uid === a.card) : undefined;
        console.log('   ', a.type, card ? c.card(card.id).name : '', 'target' in a ? nm(a.target as number) : '', 'attacker' in a ? nm(a.attacker) : '', 'slot' in a && a.type === 'potion' ? a.slot : '');
      }
    },
  } : undefined;
  const guard = fightLoop(s, io, hooks, trace);
  const pc = commanderOf(s, 'player');
  hooks.onFightEnd?.({ r, s, encId, hp0, guard });
  const enemies = Object.values(s.units).filter((u) => u.side === 'enemy' && u.origin === 'enemy').map((u) => u.def);
  io.runAct(r, { t: 'combatResult', result: s.over === 'win' ? 'win' : 'lose', hp: pc?.hp ?? 0, gold: s.goldGained, potions: s.potions, relics: s.relics, stats: s.stats, enemies });
  return s.over === 'win';
}

/** one run-layer decision; false once the run is over */
export function step(r: RunState, io: SimIO = defaultIO, hooks: SimHooks = {}): boolean {
  const c = content();
  const sc = r.screen;
  const A = (a: RunAction) => { const err = io.runAct(r, a); if (err) throw new Error(`${a.t}: ${err} @${sc.k}`); };
  switch (sc.k) {
    case 'actStart': A({ t: 'proceed' }); return true;
    case 'blessing': A({ t: 'blessing', i: hooks.blessing ? hooks.blessing(sc.options) : 0 }); return true;
    case 'map': {
      // drink a healing potion that works on the map when low
      const mp = r.potions.findIndex((p) => !!p && !!c.potions.get(p)?.outOfCombat);
      if (mp >= 0 && r.hp < r.maxHp * 0.5) { A({ t: 'mapPotion', slot: mp }); return true; }
      const opts = availableNodes(r);
      if (!opts.length) throw new Error('no nodes');
      const hpk = r.hp / r.maxHp;
      const pref = (t: string) => ({ camp: hpk < 0.5 ? 10 : 2, elite: hpk > 0.7 ? 6 : 0, shop: r.gold > 150 ? 7 : 1, combat: 4, event: 4, chest: 8, recruit: r.lieutenant ? 1 : 9, stargaze: 3, boss: 10 } as Record<string, number>)[t] ?? 1;
      const best = [...opts].sort((a, b) => pref(b.type) - pref(a.type) || a.col - b.col)[0]!;
      A({ t: 'go', row: best.row, col: best.col });
      return true;
    }
    case 'combat': fight(r, io, hooks); return true;
    case 'reward': {
      const i = sc.items.findIndex((it) => !it.taken);
      if (i < 0) { A({ t: 'proceed' }); return true; }
      const it = sc.items[i]!;
      if (it.k === 'cards') {
        const best = [...it.options].map((o, k) => ({ o, k })).sort((a, b) => score(b.o.id) - score(a.o.id))[0];
        // keep the deck from bloating: commons only while the deck is small (a human skips far more often)
        const take = best && (r.deck.length < 18 || (score(best.o.id) >= 2 && r.deck.length < 28) || score(best.o.id) >= 3);
        hooks.onCardOffer?.(it.options, take ? best.o.id : null);
        A({ t: 'take', i, choice: take ? best!.k : null });
      } else if (it.k === 'potion' && !r.potions.includes(null)) { io.markTaken(r, i); }
      else A({ t: 'take', i });
      return true;
    }
    case 'bossRelic': A({ t: 'bossRelic', i: 0 }); return true;
    case 'shop': {
      if (!sc.shop.removed && r.gold >= sc.shop.removePrice) { A({ t: 'removeService' }); return true; }
      const ci = sc.shop.cards.findIndex((x) => !x.sold && x.price <= r.gold && score(x.card.id) >= 2);
      if (ci >= 0) { A({ t: 'buy', what: 'card', i: ci }); return true; }
      const ri = sc.shop.relics.findIndex((x) => !x.sold && x.price <= r.gold);
      if (ri >= 0) { A({ t: 'buy', what: 'relic', i: ri }); return true; }
      A({ t: 'proceed' });
      return true;
    }
    case 'camp': {
      if (sc.done) { A({ t: 'proceed' }); return true; }
      const canUp = pickCandidates(r, 'upgrade').length > 0;
      // preferred option first; fall back when a rule forbids it (e.g. no healing at camps)
      const prefer: ('heal' | 'upgrade' | 'remove')[] = r.hp / r.maxHp < 0.55 || !canUp ? ['heal', 'upgrade', 'remove'] : ['upgrade', 'heal', 'remove'];
      if (!prefer.some((opt) => !io.runAct(r, { t: 'rest', opt }))) A({ t: 'proceed' });
      return true;
    }
    case 'pick': {
      const cands = pickCandidates(r, sc.kind, sc.filter);
      const order = [...cands].sort((a, b) => (sc.kind === 'remove' ? score(a.id) - score(b.id) : score(b.id) - score(a.id)));
      A({ t: 'pick', uids: order.slice(0, sc.n).map((x) => x.uid) });
      return true;
    }
    case 'cardChoice': A({ t: 'pick', uids: sc.options.slice(0, sc.n).map((o) => o.uid) }); return true;
    case 'event': {
      if (sc.outcome !== undefined) { A({ t: 'proceed' }); return true; }
      const ev = c.events.get(sc.id)!;
      const opts = sc.page ? ev.pages!.find((p) => p.id === sc.page)!.options : ev.options;
      for (let i = 0; i < opts.length; i++) { const err = io.runAct(r, { t: 'event', i }); if (!err) return true; }
      throw new Error(`event ${sc.id}: no valid option`);
    }
    case 'recruit': A({ t: 'recruit', i: sc.done ? null : sc.options.length ? 0 : null }); if (sc.done) A({ t: 'proceed' }); return true;
    case 'stargaze': if (sc.done) { A({ t: 'proceed' }); return true; } A(sc.mode ? { t: 'fate', op: sc.mode, idx: 0, suit: 'sun' } : { t: 'fate', op: 'preview' }); return true;
    case 'chest': A(sc.opened ? { t: 'proceed' } : { t: 'open' }); return true;
    case 'hiddenChoice': A({ t: 'hidden', go: false }); return true;
    case 'victory': case 'defeat': return false;
  }
}
