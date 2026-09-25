/**
 * Simple deterministic player AI, used by the balance simulator, smoke tests and "auto" debugging.
 * Greedy one-ply: evaluates each legal action on a cloned state and picks the best by heuristic.
 */
import type { CombatState, PlayerAction, Unit } from './state';
import { act, attackOptions, playableInfo, skillUsable } from './api';
import { alive, atkOf, commanderOf, unitsOf } from './board';
import { cardDef } from './core';
import { intentPreview } from './intents';
import { content } from '../content';

export function autoAnswer(s: CombatState): PlayerAction {
  const d = s.pending;
  if (!d) return { type: 'pass' };
  switch (d.kind) {
    case 'response': {
      // respond with the first option if it has no target requirement
      const uid = d.options[0];
      if (uid !== undefined) {
        const card = s.hand.find((c) => c.uid === uid);
        const def = card ? cardDef(card) : null;
        if (def && (!def.target || def.target === 'none')) return { type: 'respond', card: uid };
        if (def && def.target) {
          const t = d.actor ?? d.target;
          if (t != null) return { type: 'respond', card: uid, target: def.target.startsWith('enemy') ? d.actor : commanderOf(s, 'player')?.uid ?? null };
        }
      }
      return { type: 'pass' };
    }
    case 'chooseCards': {
      // discard/exhaust the cheapest-value cards; discover the first
      const sorted = [...d.cards].sort((a, b) => cardScore(a.id) - cardScore(b.id));
      return { type: 'choose', picks: sorted.slice(0, d.min).map((c) => c.uid) };
    }
    case 'chooseOption': return { type: 'choose', picks: [0] };
    case 'stargaze': {
      const yang = d.cards.filter((c) => c.suit === 'sun' || c.suit === 'thunder');
      const yin = d.cards.filter((c) => !(c.suit === 'sun' || c.suit === 'thunder'));
      return { type: 'arrange', top: [...yang, ...yin].map((c) => c.id), bottom: [] };
    }
    case 'rejudge': {
      const cur = d.card;
      const yang = cur.suit === 'sun' || cur.suit === 'thunder';
      if (yang) return { type: 'rejudge', sign: null };
      const i = d.signs.findIndex((c) => c.suit === 'sun' || c.suit === 'thunder');
      return { type: 'rejudge', sign: i >= 0 ? i : null };
    }
  }
}

function cardScore(id: string): number {
  const d = content().card(id);
  if (d.type === 'status' || d.type === 'curse') return -10;
  const r = { basic: 0, common: 1, rare: 2, epic: 3, legendary: 4, token: 0, special: 1 }[d.rarity];
  return r;
}

/** evaluation from the player's perspective */
export function evaluate(s: CombatState): number {
  if (s.over === 'win') return 1e6;
  if (s.over === 'lose') return -1e6;
  const pc = commanderOf(s, 'player');
  let v = 0;
  v += (pc?.hp ?? 0) * 3 + (pc?.armor ?? 0) * 1.2;
  for (const u of unitsOf(s, 'player')) v += atkOf(s, u) * 2 + u.hp * 1.2 + (u.row === 'front' ? 1 : 0);
  // one-ply search can't see past phase thresholds (e.g. a split at 50% HP) and would stall forever;
  // the longer a fight runs, the more finishing it outweighs the threat of the next phase
  const press = 1 + Math.max(0, s.turn - 6) * 0.35;
  for (const e of unitsOf(s, 'enemy', true)) {
    const key = ['elite', 'boss'].includes(content().enemies.get(e.def)?.tier ?? '') || e.kind === 'commander';
    v -= e.hp * (e.kind === 'commander' ? 1.5 : 1.3) * (key ? press : 1) + atkOf(s, e) * 2;
    v += (e.statuses.burn ?? 0) * 0.8 + (e.statuses.poison ?? 0) * 1.5 + (e.statuses.vulnerable ?? 0) * 2 + (e.statuses.weak ?? 0) * 2;
    v += (e.statuses.stun ?? 0) * 6 + (e.statuses.freeze ?? 0) * 4;
    const pv = intentPreview(s, e);
    if (pv?.damage) {
      const tgt = s.units[pv.target ?? -1];
      const incoming = pv.damage * (pv.hits ?? 1);
      if (tgt && tgt.kind === 'commander') v -= Math.max(0, incoming - tgt.armor) * 2.2;
      else v -= incoming * 0.6;
    }
  }
  v += s.sources.filter((x) => !x.temp).length * 4;
  v += s.hand.length * 0.3;
  v += s.fate.signs.length * 2;
  return v;
}

export function legalActions(s: CombatState): PlayerAction[] {
  const out: PlayerAction[] = [];
  if (s.phase !== 'main' || s.pending) return out;
  for (const card of s.hand) {
    const info = playableInfo(s, card);
    if (!info.playable) continue;
    const def = cardDef(card);
    if (def.type === 'unit') {
      const pref = def.unit?.prefersBack || (def.unit?.keywords ?? []).includes('ranged') ? 'back' : 'front';
      const slot = info.slots!.find((x) => x.row === pref) ?? info.slots![0]!;
      out.push({ type: 'play', card: card.uid, slot });
    } else if (info.targets) {
      for (const t of info.targets.slice(0, 6)) out.push({ type: 'play', card: card.uid, target: t });
    } else out.push({ type: 'play', card: card.uid });
  }
  for (const a of attackOptions(s)) for (const t of a.targets) out.push({ type: 'attack', attacker: a.attacker, target: t });
  s.skills.forEach((_, i) => {
    const u = skillUsable(s, i);
    if (!u.ok) return;
    if (u.targets) for (const t of u.targets.slice(0, 4)) out.push({ type: 'skill', skill: i, target: t });
    else out.push({ type: 'skill', skill: i });
  });
  return out;
}

function clone(s: CombatState): CombatState { return structuredClone(s); }

function settle(s: CombatState) {
  for (let i = 0; i < 20 && s.pending; i++) act(s, autoAnswer(s));
}

/** pick the best next action (or endTurn) */
export function chooseAction(s: CombatState): PlayerAction {
  const base = evaluate(s);
  let best: PlayerAction = { type: 'endTurn' };
  let bestV = base;
  const acts = legalActions(s);
  for (const a of acts) {
    const c = clone(s);
    const r = act(c, a);
    if (!r.ok) continue;
    settle(c);
    const v = evaluate(c);
    if (v > bestV + 0.01) { bestV = v; best = a; }
  }
  // sacrifice: once per turn, sacrifice the lowest-value unplayable/basic card when no better play exists or early
  if (best.type === 'endTurn' || s.sacrificesThisTurn === 0) {
    const sac = pickSacrifice(s);
    if (sac && s.sacrificesThisTurn === 0 && (best.type === 'endTurn' || s.sources.length < 6)) return { type: 'sacrifice', card: sac };
  }
  return best;
}

function pickSacrifice(s: CombatState): number | null {
  if (s.sacrificesThisTurn > 0 || !s.hand.length) return null;
  const ranked = [...s.hand].sort((a, b) => sacValue(s, a.uid) - sacValue(s, b.uid));
  const pick = ranked[0];
  if (!pick) return null;
  // enough sources: only burn junk (status / curse), never thin the deck of real cards
  const junk = ['status', 'curse'].includes(cardDef(pick).type);
  if (s.sources.length >= 7 && !junk) return null;
  return pick.uid;
}

function sacValue(s: CombatState, uid: number): number {
  const card = s.hand.find((c) => c.uid === uid)!;
  const d = cardDef(card);
  let v = cardScore(card.id) * 3;
  if ((d.keywords ?? []).includes('offering')) v -= 5;
  // damage is the scarce resource in a long fight: keep attacks, offer defensive/utility cards first
  if (JSON.stringify(d.effects ?? []).includes('"damage"') || d.type === 'unit') v += 2;
  if (!playableInfo(s, card).playable) v -= 1;
  return v;
}

/** play a whole player turn with the greedy AI; returns false if stuck */
export function playTurn(s: CombatState, maxActions = 30): void {
  for (let i = 0; i < maxActions && !s.over; i++) {
    settle(s);
    if (s.over || s.phase !== 'main') break;
    const a = chooseAction(s);
    const r = act(s, a);
    if (!r.ok) { act(s, { type: 'endTurn' }); break; }
    if (a.type === 'endTurn') break;
  }
  settle(s);
}

export function isAliveUnit(u: Unit | undefined) { return alive(u); }
