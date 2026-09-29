/** Enemy intent scripts: move selection, targeting and live previews. */
import { content } from '../content';
import type { EnemyAI, EnemyMove, EnemyTargetRule, IntentType, Effect } from '../defs';
import { rand, pick, weightedPick } from '../rng';
import type { CombatState, Unit } from './state';
import { alive, attackTargets, atkOf, commanderOf, depth, hasKw, maxHpOf, reach, unit, unitsOf } from './board';
import { evalCond, evalValue } from './eval';
import { calcDamage, emit } from './core';

/** a move's display name: "{key}" is replaced by the name of the card the enemy remembers under that key */
export function moveName(u: Unit, mv: EnemyMove): string {
  return mv.name.replace(/\{(\w+)\}/g, (_, k: string) => {
    const id = u.mem?.[k];
    return typeof id === 'string' && content().cards.has(id) ? content().card(id).name : '——';
  });
}

export function enemyMoves(u: Unit): Record<string, EnemyMove> {
  const def = content().enemy(u.def);
  const ph = u.phase ? def.phases?.[u.phase - 1] : undefined;
  return ph?.moves ? { ...def.moves, ...ph.moves } : def.moves;
}

function enemyAI(u: Unit): EnemyAI {
  const def = content().enemy(u.def);
  const ph = u.phase ? def.phases?.[u.phase - 1] : undefined;
  return ph?.ai ?? def.ai;
}

function canUseMove(s: CombatState, u: Unit, mv: EnemyMove): boolean {
  if (mv.intent.includes('attack') && u.kind === 'unit' && reach(s, u) <= 0) {
    // back-row melee: attack only if it can advance
    return u.row === 'front' || s.sides[u.side].front.some((id) => !alive(unit(s, id)));
  }
  if (mv.intent.includes('summon')) {
    const sd = s.sides[u.side];
    return [...sd.front, ...sd.back].some((id) => !alive(unit(s, id)));
  }
  return true;
}

function chooseMove(s: CombatState, u: Unit, ai: EnemyAI, moves: Record<string, EnemyMove>, depthGuard = 0): string {
  const st = u.ai!;
  const ok = (m: string) => !!moves[m] && canUseMove(s, u, moves[m]!);
  switch (ai.type) {
    case 'cycle': {
      const len = ai.sequence.length;
      if (st.cycle === 0 && ai.start === 'random') st.cycle = Math.floor(rand(s.rng) * len);
      else if (st.cycle === 0 && typeof ai.start === 'number') st.cycle = ai.start;
      for (let k = 0; k < len; k++) {
        const m = ai.sequence[(st.cycle + k) % len]!;
        if (ok(m)) { st.cycle = st.cycle + k + 1; return m; }
      }
      st.cycle += 1;
      return ai.sequence[0]!;
    }
    case 'weighted': {
      const entries = Object.entries(ai.weights).filter(([m]) => ok(m));
      const nr = ai.noRepeat ?? 0;
      const filtered = entries.filter(([m]) => {
        if (nr <= 0) return true;
        const last = st.history.slice(-nr);
        return !(last.length === nr && last.every((h) => h === m));
      });
      const pool = filtered.length ? filtered : entries;
      if (!pool.length) return Object.keys(ai.weights)[0]!;
      return weightedPick(s.rng, pool, (e) => e[1])![0];
    }
    case 'script': {
      const firsts = ai.first ?? [];
      const turnNo = st.history.length;
      if (turnNo < firsts.length && ok(firsts[turnNo]!)) return firsts[turnNo]!;
      const ctx = { side: u.side, source: u.uid, kind: 'unit' as const, target: null, vars: {} };
      for (const [i, r] of (ai.rules ?? []).entries()) {
        const key = `r${i}`;
        if (r.once && st.fired.includes(key)) continue;
        if (!ok(r.move)) continue;
        if (evalCond(s, r.if, ctx)) { if (r.once) st.fired.push(key); return r.move; }
      }
      if (depthGuard > 5) return Object.keys(moves)[0]!;
      return chooseMove(s, u, ai.then, moves, depthGuard + 1);
    }
  }
}

export function rollIntent(s: CombatState, u: Unit) {
  if (u.side !== 'enemy' || u.origin !== 'enemy' || !alive(u)) return;
  const moves = enemyMoves(u);
  const id = chooseMove(s, u, enemyAI(u), moves);
  const mv = moves[id];
  u.ai!.history.push(id);
  const target = mv ? pickTarget(s, u, mv.target ?? defaultRule(mv)) : null;
  u.intent = { move: id, target };
  emit(s, { t: 'intent', uid: u.uid, move: id, target });
}

function defaultRule(mv: EnemyMove): EnemyTargetRule {
  return mv.intent.includes('attack') ? 'default' : mv.intent.includes('debuff') ? 'default' : 'none';
}

export function pickTarget(s: CombatState, u: Unit, rule: EnemyTargetRule): number | null {
  const foes = unitsOf(s, 'player', true).filter((f) => !f.stealth);
  const cmd = commanderOf(s, 'player');
  switch (rule) {
    case 'none': return null;
    case 'self': return u.uid;
    case 'commander': return cmd?.uid ?? null;
    case 'default': {
      const legal = attackTargets(s, u, u.kind === 'unit' && u.row === 'back');
      if (legal.length) {
        if (cmd && legal.some((l) => l.uid === cmd.uid)) return cmd.uid;
        return pick(s.rng, legal)!.uid;
      }
      const sorted = [...foes].sort((a, b) => depth(s, a) - depth(s, b));
      return sorted[0]?.uid ?? null;
    }
    case 'randomUnit': {
      const us = foes.filter((f) => f.kind === 'unit');
      return (pick(s.rng, us) ?? cmd)?.uid ?? null;
    }
    case 'lowestHp': {
      const legal = attackTargets(s, u, true);
      const list = legal.length ? legal : foes;
      return [...list].sort((a, b) => a.hp - b.hp || a.ts - b.ts)[0]?.uid ?? null;
    }
    case 'highestAtk': {
      const us = foes.filter((f) => f.kind === 'unit');
      if (!us.length) return cmd?.uid ?? null;
      return [...us].sort((a, b) => atkOf(s, b) - atkOf(s, a) || a.ts - b.ts)[0]!.uid;
    }
    case 'ally': {
      const allies = unitsOf(s, 'enemy', true).filter((a) => a.uid !== u.uid);
      return (pick(s.rng, allies) ?? u).uid;
    }
    case 'allyLowest': {
      const allies = unitsOf(s, 'enemy', true);
      return [...allies].sort((a, b) => a.hp / maxHpOf(s, a) - b.hp / maxHpOf(s, b))[0]?.uid ?? u.uid;
    }
  }
}

/** re-validate an intent target at declaration time */
export function retarget(s: CombatState, u: Unit, mv: EnemyMove): number | null {
  const rule = mv.target ?? defaultRule(mv);
  const cur = u.intent?.target ?? null;
  const t = unit(s, cur);
  if (rule === 'none') return null;
  if (rule === 'self') return u.uid;
  if (!alive(t)) return pickTarget(s, u, rule);
  if (rule === 'default') {
    const legal = attackTargets(s, u, u.kind === 'unit' && u.row === 'back');
    if (legal.length && !legal.some((l) => l.uid === t.uid)) return pickTarget(s, u, rule);
    if (t.stealth) return pickTarget(s, u, rule);
  }
  return t.uid;
}

// ───────────── previews ─────────────

export interface IntentPreview {
  types: IntentType[];
  name: string;
  damage?: number;
  hits?: number;
  target: number | null;
  armor?: number;
  statuses: { status: string; amount: number }[];
  summons?: number;
}

export function intentPreview(s: CombatState, u: Unit): IntentPreview | null {
  if (!u.intent) return null;
  const mv = enemyMoves(u)[u.intent.move];
  if (!mv) return null;
  const ctx = { side: u.side, source: u.uid, kind: 'move' as const, target: u.intent.target, vars: { atk: atkOf(s, u) } };
  const tgt = unit(s, u.intent.target);
  const out: IntentPreview = { types: mv.intent, name: moveName(u, mv), target: u.intent.target, statuses: [] };
  const walk = (effs: Effect[]) => {
    for (const e of effs) {
      if (e.op === 'attack') {
        const base = e.amount === undefined ? atkOf(s, u) : evalValue(s, e.amount, ctx);
        const hits = e.times === undefined ? 1 : evalValue(s, e.times, ctx);
        const d = tgt ? calcDamage(s, u, tgt, base, 'attack') : base;
        out.damage = (out.damage ?? 0) === 0 ? d : out.damage; out.hits = (out.hits ?? 0) + hits;
      } else if (e.op === 'damage' && (e.target === 'target' || e.target === 'commander' || e.target === 'enemyCommander' || e.target === 'allEnemies')) {
        const base = evalValue(s, e.amount, ctx);
        const hits = e.times === undefined ? 1 : evalValue(s, e.times, ctx);
        const d = tgt ? calcDamage(s, u, tgt, base, 'effect', !!e.attack) : base;
        out.damage = (out.damage ?? 0) === 0 ? d : out.damage; out.hits = (out.hits ?? 0) + hits;
      } else if (e.op === 'armor') out.armor = (out.armor ?? 0) + safeVal(s, e.amount, ctx);
      else if (e.op === 'status') out.statuses.push({ status: e.status, amount: safeVal(s, e.amount, ctx) });
      else if (e.op === 'summon') out.summons = (out.summons ?? 0) + (e.n === undefined ? 1 : safeVal(s, e.n, ctx));
      else if (e.op === 'repeat') { const t = safeVal(s, e.times, ctx); for (let i = 0; i < t; i++) walk(e.effects); }
    }
  };
  walk(mv.effects);
  return out;
}

function safeVal(s: CombatState, v: Parameters<typeof evalValue>[1], ctx: Parameters<typeof evalValue>[2]) {
  try { return evalValue(s, v, ctx); } catch { return 0; }
}

export { hasKw };
