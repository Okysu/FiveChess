/** Debug: list the AI's legal actions and scores on turn 1 of a fight.  npx tsx scripts/trace-ai.ts [enc] */
import { loadContent } from './load-content';
import { createCombat, act, playableInfo } from '../src/engine/combat/api';
import { legalActions, evaluate, chooseAction } from '../src/engine/combat/autoplay';
import { newRun, runAct, combatConfig, availableNodes } from '../src/engine/run/run';
import { content } from '../src/engine/content';

loadContent();
const c = content();
const r = newRun({ commander: 'r_huojin', ascension: 0, seed: 't2' });
runAct(r, { t: 'proceed' });
const n = availableNodes(r).find((x) => x.type === 'combat')!;
runAct(r, { t: 'go', row: n.row, col: n.col });
if (process.argv[2] && r.screen.k === 'combat') (r.screen as { encounter: string }).encounter = process.argv[2];
const s = createCombat(combatConfig(r));
console.log('phase', s.phase, 'pending', s.pending?.kind, 'base', evaluate(s).toFixed(1));
for (const h of s.hand) { const i = playableInfo(s, h); console.log('  ', c.card(h.id).name, JSON.stringify({ ok: i.playable, why: i.reason, t: i.targets?.length })); }
for (const a of legalActions(s)) {
  const cl = structuredClone(s);
  const res = act(cl, a);
  console.log(JSON.stringify(a), res.ok ? evaluate(cl).toFixed(1) : `ERR ${JSON.stringify(res).slice(0, 120)}`);
}
console.log('choose →', JSON.stringify(chooseAction(s)));

// step a whole turn
if (process.argv.includes('--turn')) {
  for (let i = 0; i < 12 && !s.over && s.phase === 'main'; i++) {
    const a = chooseAction(s);
    const res = act(s, a);
    console.log('step', i, JSON.stringify(a), res.ok ? 'ok' : `ERR ${JSON.stringify(res).slice(0, 160)}`, 'hand', s.hand.length, 'ready', s.sources.filter((x) => x.ready).length, 'pending', s.pending?.kind ?? '-', 'phase', s.phase);
    if (a.type === 'endTurn' || !res.ok) break;
  }
}
