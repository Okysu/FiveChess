/**
 * Balance simulator: plays full adventures with the greedy combat AI and simple run heuristics.
 *   npm run sim -- [--runs=40] [--asc=0] [--commanders=r_huojin,b_shiyun] [--verbose] [--noReport] [--out=.cache/sim/x.json]
 * Writes docs/平衡报告.md and .cache/sim/report.json (or --out). The JSON carries per-run records
 * (fights, act reached, cause of death) so several processes' outputs can be merged (scripts/sim-merge.ts).
 */
import fs from 'node:fs';
import { loadContent } from './load-content';
import { createCombat, act as combatAct } from '../src/engine/combat/api';
import { playTurn, autoAnswer, chooseAction, legalActions, aiErrors } from '../src/engine/combat/autoplay';
import { newRun, runAct, combatConfig, availableNodes, pickCandidates, type RunState, type RunAction } from '../src/engine/run/run';
import { content } from '../src/engine/content';
import { commanderOf } from '../src/engine/combat/board';
import { BY_ACT_TIER, BY_ENCOUNTER } from '../src/engine/combat/tuning';
import type { CombatState } from '../src/engine/combat/state';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k!, v ?? 'true']; }));
const RUNS = Number(args.runs ?? 20);
const FROM = Number(args.from ?? 0);
const ASC = Number(args.asc ?? 0);
loadContent();
const c = content();
const commanders = args.commanders ? args.commanders.split(',') : [...c.commanders.keys()];

interface Stat { n: number; wins: number; floors: number }
const byCmd: Record<string, Stat> = {};
const cardSeen: Record<string, { offered: number; picked: number; inWinningDecks: number; inDecks: number; floorSum?: number }> = {};
const actReached: Record<number, number> = {};
const relicStat: Record<string, { n: number; wins: number; floorSum?: number }> = {};
const encStat: Record<string, { fights: number; deaths: number; turns: number; hpLost: number }> = {};
interface FightRec { enc: string; act: number; tier: string; hp0: number; hp1: number; maxHp: number; turns: number; win: boolean; dealt: number; deck: number }
interface RunRec { cmd: string; asc: number; seed: string; win: boolean; act: number; floors: number; bossActs: number[]; died: string | null; fights: FightRec[]; deck: number; relics: number; lieutenant: string | null }
const runs: RunRec[] = [];
let curFights: FightRec[] = [];
const errors: string[] = [];
let combatsTotal = 0;
const t0 = Date.now();

function score(id: string): number {
  const d = c.card(id);
  return { basic: 0, common: 1, rare: 2, epic: 3, legendary: 4, token: 0, special: 0 }[d.rarity] + (d.type === 'unit' ? 0.3 : 0);
}

let stalls = 0;
/** answer pending decisions; an answer the engine rejects falls back to "pass" so a bad AI answer can't hang the fight */
function answerAll(s: CombatState) {
  for (let i = 0; i < 20 && s.pending; i++) {
    if (combatAct(s, autoAnswer(s)).ok) continue;
    if (!combatAct(s, { type: 'pass' }).ok) { stalls++; break; }
  }
}

function fight(r: RunState): boolean {
  const s: CombatState = createCombat(combatConfig(r));
  const encId = r.screen.k === 'combat' ? r.screen.encounter : '?';
  const hp0 = r.hp;
  let guard = 0;
  // --trace=<floor>: print the bot's decisions for the fight on that floor (debugging the AI)
  const tracing = args.trace !== undefined && Number(args.trace) === r.floor;
  const nm = (uid: number | null | undefined) => { const u = uid == null ? undefined : s.units[uid]; return u ? `${u.name}${u.hp}` : String(uid); };
  if (tracing) console.log(`TRACE ${encId} deck: ${r.deck.map((d) => c.card(d.id).name + (d.up ? '+' : '')).join(' ')}`);
  while (!s.over && guard++ < 60) {
    answerAll(s);
    if (s.over) break;
    const a0 = s.actions.length;
    if (tracing) {
      const pc0 = commanderOf(s, 'player');
      if (args.debug) { console.log("   dbg phase", s.phase, "pending", s.pending?.kind, "tasks", s.tasks.length, "legal", legalActions(s).length, JSON.stringify(chooseAction(s))); }
      console.log(`T${s.turn} hp ${pc0?.hp}+${pc0?.armor} src ${s.sources.length} hand [${s.hand.map((h) => c.card(h.id).name).join(' ')}] foes ${Object.values(s.units).filter((u) => u.side === 'enemy' && u.hp > 0).map((u) => `${u.name}${u.hp}+${u.armor}`).join(' ')}`);
    }
    // playTurn ends the turn itself; only force an end if the AI got stuck on the same turn
    const turn = s.turn;
    playTurn(s);
    answerAll(s);
    if (s.phase === 'main' && !s.over && s.turn === turn) combatAct(s, { type: 'endTurn' });
    if (tracing) for (const a of s.actions.slice(a0)) {
      const card = 'card' in a && typeof a.card === 'number' ? [...s.hand, ...s.discard, ...s.draw, ...s.exhaust, ...s.sacrificed, ...s.limbo].find((x) => x.uid === a.card) : undefined;
      console.log('   ', a.type, card ? c.card(card.id).name : '', 'target' in a ? nm(a.target as number) : '', 'attacker' in a ? nm(a.attacker) : '', 'slot' in a && a.type === 'potion' ? a.slot : '');
    }
  }
  if (!s.over) s.over = 'lose';
  const pc = commanderOf(s, 'player');
  const e = (encStat[encId] ??= { fights: 0, deaths: 0, turns: 0, hpLost: 0 });
  e.fights++; e.turns += s.turn;
  e.hpLost += Math.max(0, hp0 - (pc?.hp ?? 0));
  if (s.over === 'lose') e.deaths++;
  const sc0 = r.screen.k === 'combat' ? r.screen : null;
  curFights.push({ enc: encId, act: r.act, tier: sc0?.tier ?? '?', hp0, hp1: pc?.hp ?? 0, maxHp: r.maxHp, turns: s.turn, win: s.over === 'win', dealt: s.stats.damageDealt, deck: r.deck.length });
  if (args.verbose) console.log(`  act${r.act} f${r.floor} ${encId.padEnd(22)} hp ${hp0}→${pc?.hp ?? 0}/${r.maxHp} turns ${s.turn} ${s.over}${guard >= 60 ? ' (TURN CAP)' : ''} deck ${r.deck.length}`);
  combatsTotal++;
  const enemies = Object.values(s.units).filter((u) => u.side === 'enemy' && u.origin === 'enemy').map((u) => u.def);
  runAct(r, { t: 'combatResult', result: s.over === 'win' ? 'win' : 'lose', hp: pc?.hp ?? 0, gold: s.goldGained, potions: s.potions, relics: s.relics, stats: s.stats, enemies });
  return s.over === 'win';
}

function step(r: RunState): boolean {
  const sc = r.screen;
  const A = (a: RunAction) => { const err = runAct(r, a); if (err) throw new Error(`${a.t}: ${err} @${sc.k}`); };
  switch (sc.k) {
    case 'actStart': A({ t: 'proceed' }); return true;
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
    case 'combat': fight(r); return true;
    case 'reward': {
      const i = sc.items.findIndex((it) => !it.taken);
      if (i < 0) { A({ t: 'proceed' }); return true; }
      const it = sc.items[i]!;
      if (it.k === 'cards') {
        for (const o of it.options) (cardSeen[o.id] ??= { offered: 0, picked: 0, inWinningDecks: 0, inDecks: 0 }).offered++;
        const best = [...it.options].map((o, k) => ({ o, k })).sort((a, b) => score(b.o.id) - score(a.o.id))[0];
        // keep the deck from bloating: commons only while the deck is small (a human skips far more often)
        const take = best && (r.deck.length < 18 || (score(best.o.id) >= 2 && r.deck.length < 28) || score(best.o.id) >= 3);
        if (take) cardSeen[best.o.id]!.picked++;
        A({ t: 'take', i, choice: take ? best!.k : null });
      } else if (it.k === 'potion' && !r.potions.includes(null)) { it.taken = true; }
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
      if (!prefer.some((opt) => !runAct(r, { t: 'rest', opt }))) A({ t: 'proceed' });
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
      for (let i = 0; i < opts.length; i++) { const err = runAct(r, { t: 'event', i }); if (!err) return true; }
      throw new Error(`event ${sc.id}: no valid option`);
    }
    case 'recruit': A({ t: 'recruit', i: sc.done ? null : sc.options.length ? 0 : null }); if (sc.done) A({ t: 'proceed' }); return true;
    case 'stargaze': if (sc.done) { A({ t: 'proceed' }); return true; } A(sc.mode ? { t: 'fate', op: sc.mode, idx: 0, suit: 'sun' } : { t: 'fate', op: 'preview' }); return true;
    case 'chest': A(sc.opened ? { t: 'proceed' } : { t: 'open' }); return true;
    case 'hiddenChoice': A({ t: 'hidden', go: false }); return true;
    case 'victory': case 'defeat': return false;
  }
}

for (const cmd of commanders) {
  for (let i = FROM; i < FROM + RUNS; i++) {
    const seed = `sim-${cmd}-${ASC}-${i}`;
    const r = newRun({ seed, commander: cmd, ascension: ASC, unlockedHidden: false });
    let guard = 0;
    curFights = [];
    try {
      while (guard++ < 3000 && step(r)) { /* */ }
    } catch (e) { errors.push(`${seed}: ${(e as Error).message}`); r.result = 'lose'; }
    const win = r.result === 'win';
    const st = (byCmd[cmd] ??= { n: 0, wins: 0, floors: 0 });
    st.n++; if (win) st.wins++; st.floors += r.stats.floors;
    actReached[r.act] = (actReached[r.act] ?? 0) + 1;
    runs.push({ cmd, asc: ASC, seed, win, act: r.act, floors: r.stats.floors, bossActs: curFights.filter((f) => f.tier === 'boss').map((f) => f.act), died: win ? null : r.nemesis ?? null, fights: curFights, deck: r.deck.length, relics: r.relics.length, lieutenant: r.lieutenant });
    // the greedy bot rarely wins, so "floors reached" is the useful progress signal
    for (const d of new Set(r.deck.map((x) => x.id))) { const cs = (cardSeen[d] ??= { offered: 0, picked: 0, inWinningDecks: 0, inDecks: 0 }); cs.inDecks++; cs.floorSum = (cs.floorSum ?? 0) + r.stats.floors; if (win) cs.inWinningDecks++; }
    for (const rl of r.relics) { const s2 = (relicStat[rl.id] ??= { n: 0, wins: 0, floorSum: 0 }); s2.n++; s2.floorSum = (s2.floorSum ?? 0) + r.stats.floors; if (win) s2.wins++; }
  }
  process.stdout.write(`${cmd}: ${byCmd[cmd]!.wins}/${byCmd[cmd]!.n} (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`);
}

// ───────────── report ─────────────
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');
const totalRuns = Object.values(byCmd).reduce((s, x) => s + x.n, 0);
const totalWins = Object.values(byCmd).reduce((s, x) => s + x.wins, 0);
const cards = Object.entries(cardSeen).filter(([id]) => !['basic', 'token', 'special'].includes(c.card(id).rarity));
const deckRate = cards.filter(([, v]) => v.inDecks >= 5).map(([id, v]) => ({ id, name: c.card(id).name, f: c.card(id).faction, win: v.inWinningDecks / v.inDecks, floors: (v.floorSum ?? 0) / v.inDecks, n: v.inDecks, pick: v.offered ? v.picked / v.offered : 0 }));
deckRate.sort((a, b) => b.floors - a.floors);
const encs = Object.entries(encStat).map(([id, v]) => ({ id, ...v, death: v.deaths / v.fights, avgHp: v.hpLost / v.fights, avgTurns: v.turns / v.fights })).sort((a, b) => b.avgHp - a.avgHp);
const relics = Object.entries(relicStat).filter(([, v]) => v.n >= 4).map(([id, v]) => ({ id, name: c.relic(id).name, win: v.wins / v.n, floors: (v.floorSum ?? 0) / v.n, n: v.n })).sort((a, b) => b.floors - a.floors);

const md: string[] = [];
md.push('# 平衡报告（自动模拟）', '', `> 生成：${new Date().toISOString()} · 逆命 ${ASC} · 每位主帅 ${RUNS} 局 · 共 ${totalRuns} 局 / ${combatsTotal} 场战斗 · 耗时 ${((Date.now() - t0) / 1000).toFixed(0)} 秒`, '> 模拟 AI：战斗为一步前瞻贪心（src/engine/combat/autoplay.ts），冒险层为简单启发式（scripts/simulate.ts）。其绝对胜率低于人类玩家，报告用于**相对**比较。', '');
const cleared = (a: number) => runs.filter((x) => x.win || x.act > a).length;
const bossSeen = (a: number) => runs.filter((x) => x.bossActs.includes(a)).length;
md.push(`## 总体`, '', `胜率 ${pct(totalWins, totalRuns)} · 止步幕数：${Object.entries(actReached).sort().map(([a, n]) => `第${a}幕 ${pct(n, totalRuns)}`).join(' / ')}`, '', `通关第1幕 ${pct(cleared(1), totalRuns)} · 通关第2幕 ${pct(cleared(2), totalRuns)} · 到达第3幕首领 ${pct(bossSeen(3), totalRuns)} · 通关第3幕 ${pct(cleared(3), totalRuns)} · 胜利 ${pct(totalWins, totalRuns)}`, '');
md.push('## 主帅', '', '| 主帅 | 局数 | 胜率 | 通关第1幕 | 通关第2幕 | 平均到达层数 |', '|---|---|---|---|---|---|');
for (const [id, v] of Object.entries(byCmd)) { const rs = runs.filter((x) => x.cmd === id); md.push(`| ${c.commander(id).name} | ${v.n} | ${pct(v.wins, v.n)} | ${pct(rs.filter((x) => x.win || x.act > 1).length, rs.length)} | ${pct(rs.filter((x) => x.win || x.act > 2).length, rs.length)} | ${(v.floors / v.n).toFixed(1)} |`); }
md.push('', '## 遭遇战强度（按平均失血排序，前 15）', '', '| 遭遇战 | 场次 | 死亡率 | 平均失血 | 平均回合 |', '|---|---|---|---|---|');
for (const e of encs.slice(0, 15)) md.push(`| ${e.id} | ${e.fights} | ${pct(e.deaths, e.fights)} | ${e.avgHp.toFixed(1)} | ${e.avgTurns.toFixed(1)} |`);
md.push('', '## 首领与精英（全部）', '', '| 遭遇战 | 场次 | 死亡率 | 平均失血 | 平均回合 |', '|---|---|---|---|---|');
for (const e of encs.filter((x) => /boss|elite/.test(x.id)).sort((a, b) => a.id.localeCompare(b.id))) md.push(`| ${e.id} | ${e.fights} | ${pct(e.deaths, e.fights)} | ${e.avgHp.toFixed(1)} | ${e.avgTurns.toFixed(1)} |`);
md.push('', '## 难度曲线（src/engine/combat/tuning.ts）', '', '敌方生命 / 伤害倍率，按幕与层级；逆命加成叠加其上。', '', '| 幕 | 简单战 | 普通战 | 精英 | 首领 |', '|---|---|---|---|---|');
for (const [a, row] of Object.entries(BY_ACT_TIER)) md.push(`| ${a} | ${row.easy.hp}/${row.easy.dmg} | ${row.normal.hp}/${row.normal.dmg} | ${row.elite.hp}/${row.elite.dmg} | ${row.boss.hp}/${row.boss.dmg} |`);
md.push('', '单独修正：', '', ...Object.entries(BY_ENCOUNTER).map(([id, t]) => `- ${id}：生命 ×${t.hp}，伤害 ×${t.dmg}`));
md.push('', '## 卡牌：所在牌组平均到达层数（出现 ≥5 次）', '', '### 最高 15', '', '| 卡牌 | 色 | 牌组出现 | 平均层数 | 胜率 | 被选率 |', '|---|---|---|---|---|---|');
for (const x of deckRate.slice(0, 15)) md.push(`| ${x.name} | ${x.f} | ${x.n} | ${x.floors.toFixed(1)} | ${pct(x.win, 1)} | ${pct(x.pick, 1)} |`);
md.push('', '### 最低 15', '', '| 卡牌 | 色 | 牌组出现 | 平均层数 | 胜率 | 被选率 |', '|---|---|---|---|---|---|');
for (const x of deckRate.slice(-15).reverse()) md.push(`| ${x.name} | ${x.f} | ${x.n} | ${x.floors.toFixed(1)} | ${pct(x.win, 1)} | ${pct(x.pick, 1)} |`);
md.push('', '## 遗物：持有时平均到达层数（持有 ≥4 次）', '', '| 遗物 | 持有 | 平均层数 | 胜率 |', '|---|---|---|---|');
for (const x of relics.slice(0, 20)) md.push(`| ${x.name} | ${x.n} | ${x.floors.toFixed(1)} | ${pct(x.win, 1)} |`);
if (errors.length) { md.push('', '## 引擎/内容错误', '', ...errors.slice(0, 40).map((e) => `- ${e}`)); }
fs.mkdirSync('.cache/sim', { recursive: true });
fs.writeFileSync(args.out ?? '.cache/sim/report.json', JSON.stringify({ asc: ASC, byCmd, encs, deckRate, relics, errors, runs, cardSeen, relicStat }));
if (!args.noReport) fs.writeFileSync('docs/平衡报告.md', md.join('\n') + '\n');
console.log(`done: ${totalWins}/${totalRuns} wins, ${combatsTotal} combats, ${errors.length} errors, ${stalls} AI stalls, ${aiErrors.length} rejected AI actions`);
for (const e of [...new Set(aiErrors)].slice(0, 10)) console.log('AI', e);
for (const e of errors.slice(0, 10)) console.log('ERR', e);
