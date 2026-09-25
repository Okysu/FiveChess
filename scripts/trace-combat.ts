/** Debug: play the first combat of a fresh run with the auto-play AI and print a per-turn trace.
 *   npx tsx scripts/trace-combat.ts [commander] [seed]
 */
import { loadContent } from './load-content';
import { createCombat, act } from '../src/engine/combat/api';
import { playTurn, autoAnswer } from '../src/engine/combat/autoplay';
import { newRun, runAct, combatConfig, availableNodes } from '../src/engine/run/run';
import { commanderOf, unitsOf } from '../src/engine/combat/board';
import { content } from '../src/engine/content';

loadContent();
const c = content();
const [cmd = 'r_huojin', seed = 'trace1', enc] = process.argv.slice(2);
const r = newRun({ commander: cmd, ascension: 0, seed });
runAct(r, { t: 'proceed' });
const n = availableNodes(r).find((x) => x.type === 'combat')!;
runAct(r, { t: 'go', row: n.row, col: n.col });
if (enc && r.screen.k === 'combat') (r.screen as { encounter: string }).encounter = enc;
const s = createCombat(combatConfig(r));
const brief = () => {
  const pc = commanderOf(s, 'player');
  const foes = unitsOf(s, 'enemy', true).map((u) => `${c.enemies.get(u.def)?.name ?? u.def}:${u.hp}/${u.baseMaxHp}${u.armor ? `+${u.armor}` : ''}`).join(' ');
  return `me ${pc?.hp}/${pc?.baseMaxHp}${pc?.armor ? `+${pc.armor}` : ''} src ${s.sources.filter((x) => x.ready).length}/${s.sources.length} hand ${s.hand.length} | ${foes}`;
};
console.log('encounter', r.screen.k === 'combat' ? r.screen.encounter : '?');
let guard = 0;
while (!s.over && guard++ < 40) {
  const logBefore = s.log.length;
  console.log(`T${s.turn} start  ${brief()}`);
  console.log('   hand:', s.hand.map((h) => c.card(h.id).name).join(' '));
  for (let i = 0; i < 20 && s.pending; i++) act(s, autoAnswer(s));
  const turn = s.turn;
  playTurn(s);
  for (let i = 0; i < 20 && s.pending; i++) act(s, autoAnswer(s));
  console.log(`   after turn ${brief()}`);
  if (s.phase === 'main' && !s.over && s.turn === turn) act(s, { type: 'endTurn' });
  for (let i = 0; i < 20 && s.pending; i++) act(s, autoAnswer(s));
  for (const l of s.log.slice(logBefore)) console.log('    ·', typeof l === 'string' ? l : JSON.stringify(l).slice(0, 140));
}
console.log('result', s.over, 'turns', s.turn, brief());

if (!s.over) {
  const { legalActions, evaluate } = await import('../src/engine/combat/autoplay');
  const { playableInfo } = await import('../src/engine/combat/api');
  console.log('stalled at', s.phase, 'base', evaluate(s).toFixed(1));
  for (const h of s.hand) console.log('  ', c.card(h.id).name, JSON.stringify(playableInfo(s, h)).slice(0, 160));
  for (const a of legalActions(s)) { const cl = structuredClone(s); const res = act(cl, a); console.log('  ', JSON.stringify(a), res.ok ? evaluate(cl).toFixed(1) : JSON.stringify(res).slice(0, 100)); }
  const boss = unitsOf(s, 'enemy', true)[0];
  console.log('  foe', JSON.stringify({ hp: boss?.hp, armor: boss?.armor, ward: boss?.ward, statuses: boss?.statuses, kw: boss?.extraKeywords }));
}
if (!s.over) {
  const { chooseAction } = await import('../src/engine/combat/autoplay');
  for (let i = 0; i < 10 && s.phase === 'main' && !s.over; i++) {
    const a = chooseAction(s);
    const res = act(s, a);
    const foe = unitsOf(s, 'enemy', true).map((u) => `${u.def}:${u.hp}`).join(' ');
    console.log('  step', JSON.stringify(a), res.ok ? 'ok' : JSON.stringify(res).slice(0, 80), '| ready', s.sources.filter((x) => x.ready).length, '|', foe);
    if (a.type === 'endTurn') break;
  }
}
if (!s.over) {
  const { chooseAction, legalActions, evaluate } = await import('../src/engine/combat/autoplay');
  for (let i = 0; i < 3; i++) { const a = chooseAction(s); if (a.type === 'endTurn') break; act(s, a); }
  console.log('  -- after 3 plays, base', evaluate(s).toFixed(2), 'hand', s.hand.map((h) => h.id).join(','));
  for (const a of legalActions(s)) { const cl = structuredClone(s); const res = act(cl, a); console.log('    ', JSON.stringify(a), res.ok ? evaluate(cl).toFixed(2) : 'ERR', 'pending', cl.pending?.kind ?? '-'); }
}
