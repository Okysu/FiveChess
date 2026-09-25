import { loadContent } from './load-content';
import { createCombat, act } from '../src/engine/combat/api';
import { chooseAction, autoAnswer, evaluate } from '../src/engine/combat/autoplay';
import { newRun, combatConfig, runAct, availableNodes } from '../src/engine/run/run';
import { commanderOf, unitsOf } from '../src/engine/combat/board';
loadContent();
const r = newRun({ seed: 'trace1', commander: 'r_huojin', ascension: 0 });
runAct(r, { t: 'proceed' });
const n = availableNodes(r)[0]!;
runAct(r, { t: 'go', row: n.row, col: n.col });
const s = createCombat(combatConfig(r));
console.log('enc', s.cfg.encounter, 'hand', s.hand.map((c) => c.id).join(','), 'sources', s.sources.length);
for (let turn = 0; turn < 12 && !s.over; turn++) {
  const acts: string[] = [];
  for (let k = 0; k < 25 && !s.over && s.phase === 'main' && !s.pending; k++) {
    const a = chooseAction(s);
    acts.push(JSON.stringify(a));
    const res = act(s, a);
    if (!res.ok) { acts.push('ERR ' + res.error); break; }
    if (a.type === 'endTurn') break;
  }
  for (let i = 0; i < 20 && s.pending; i++) act(s, autoAnswer(s));
  const pc = commanderOf(s, 'player')!;
  console.log(`T${s.turn} hp=${pc.hp} enemies=${unitsOf(s, 'enemy', true).map((u) => u.name + ':' + u.hp).join(' ')} eval=${evaluate(s).toFixed(0)} acts=${acts.length} ${acts.slice(0, 6).join(' ')}`);
}
console.log('over', s.over);
