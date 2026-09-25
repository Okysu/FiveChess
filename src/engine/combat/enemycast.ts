/**
 * Boss / elite hand AI. A move with `{ op: 'script', id: 'bossCast' }` makes the enemy draw up to its
 * hand size, gain energy, then play cards one at a time (each as its own chain, so the player may
 * respond). Choice is greedy by a one-ply evaluation on a cloned state.
 */
import { content } from '../content';
import { shuffle } from '../rng';
import type { CombatState, CardInst } from './state';
import { alive, commanderOf, unit, unitsOf } from './board';
import { cardCtx, cardDef, cardTargets, emit, newUid, pushFx, registerScript, run, spliceNext } from './core';
import { evaluate } from './autoplay';

const HAND = 3;

function enemyCost(def: ReturnType<typeof cardDef>): number {
  return (def.cost.g === 'X' ? 0 : def.cost.g) + (def.cost.c?.length ?? 0);
}

function refill(s: CombatState, bossId: string) {
  const sd = s.sides.enemy;
  while (sd.hand.length < HAND) {
    if (!sd.deck.length) {
      const deck = content().enemy(bossId).deck ?? [];
      if (!deck.length) return;
      sd.deck = shuffle(s.rng, deck.map((id) => ({ uid: newUid(s), id, up: false })));
    }
    sd.hand.push(sd.deck.pop()!);
  }
}

function chooseTarget(s: CombatState, card: CardInst): number | null | undefined {
  const def = cardDef(card);
  const tg = cardTargets(s, 'enemy', def);
  if (tg === null) return null;
  if (!tg.length) return undefined;
  const hostile = def.target === 'enemy' || def.target === 'enemyUnit' || def.target === 'enemyNoCommander' || def.type === 'delay';
  if (hostile) {
    const pc = commanderOf(s, 'player');
    if (pc && tg.includes(pc.uid)) return pc.uid;
    return tg[0];
  }
  const own = tg.map((id) => unit(s, id)!).filter(alive).sort((a, b) => a.hp - b.hp);
  return own[0]?.uid ?? tg[0];
}

registerScript('bossCast', (s, task, args) => {
  const boss = unit(s, task.ctx.source);
  if (!alive(boss)) return;
  const def = content().enemy(boss.def);
  const sd = s.sides.enemy;
  if (!args.cont) {
    const en = def.energy ?? { start: 2, perTurn: 1, max: 6 };
    sd.energy = Math.min(en.max, sd.energy + en.perTurn);
    refill(s, boss.def);
  }
  const options = sd.hand.filter((c) => enemyCost(cardDef(c)) <= sd.energy);
  if (!options.length) return;
  // one-ply greedy: value from the enemy's perspective = -player eval
  let best: CardInst | null = null;
  let bestV = -Infinity;
  for (const c of options) {
    const t = chooseTarget(s, c);
    if (t === undefined) continue;
    const trial = structuredClone(s);
    trial.events = [];
    trial.tasks = [];
    trial.triggers = [];
    trial.pending = null;
    // approximate: apply the card effects directly
    const v = -quickApply(trial, c, t) + enemyCost(cardDef(c)) * 0.5;
    if (v > bestV) { bestV = v; best = c; }
  }
  if (!best) return;
  const target = chooseTarget(s, best) ?? null;
  sd.hand.splice(sd.hand.indexOf(best), 1);
  sd.energy -= enemyCost(cardDef(best));
  emit(s, { t: 'play', side: 'enemy', card: best, target });
  s.limbo.push(best);
  // continue casting after this card resolves
  spliceNext(task, [{ op: 'script', id: 'bossCast', args: { cont: true } }]);
  s.tasks.push({ k: 'chain', stage: 'window', links: [{ kind: 'card', side: 'enemy', card: best, target, slot: null, x: 0 }], passes: 0, origin: 'enemy' });
});

function quickApply(s: CombatState, card: CardInst, target: number | null): number {
  const def = cardDef(card);
  const effs = [...(def.effects ?? [])];
  if (def.type === 'unit') return evaluate(s) - 10 - (def.unit?.atk ?? 0) * 2 - (def.unit?.hp ?? 0);
  pushFx(s, effs, cardCtx(s, 'enemy', card, target));
  try { run(s); } catch { return evaluate(s); }
  return evaluate(s);
}

export function enemyHandSize(s: CombatState) { return s.sides.enemy.hand.length; }
export const _unitsOf = unitsOf;
