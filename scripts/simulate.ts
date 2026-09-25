/**
 * Balance simulator: plays full adventures with the greedy combat AI and simple run heuristics.
 *   npm run sim -- [--runs=40] [--asc=0] [--commanders=r_huojin,b_shiyun] [--combats=0]
 * Writes docs/平衡报告.md and .cache/sim/report.json.
 */
import fs from 'node:fs';
import { loadContent } from './load-content';
import { createCombat, act as combatAct } from '../src/engine/combat/api';
import { playTurn, autoAnswer } from '../src/engine/combat/autoplay';
import { newRun, runAct, combatConfig, availableNodes, pickCandidates, type RunState, type RunAction } from '../src/engine/run/run';
import { content } from '../src/engine/content';
import { commanderOf } from '../src/engine/combat/board';
import { BY_ACT_TIER, BY_ENCOUNTER } from '../src/engine/combat/tuning';
import type { CombatState } from '../src/engine/combat/state';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k!, v ?? 'true']; }));
const RUNS = Number(args.runs ?? 20);
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
const errors: string[] = [];
let combatsTotal = 0;
const t0 = Date.now();

function score(id: string): number {
  const d = c.card(id);
  return { basic: 0, common: 1, rare: 2, epic: 3, legendary: 4, token: 0, special: 0 }[d.rarity] + (d.type === 'unit' ? 0.3 : 0);
}

function fight(r: RunState): boolean {
  const s: CombatState = createCombat(combatConfig(r));
  const encId = r.screen.k === 'combat' ? r.screen.encounter : '?';
  const hp0 = r.hp;
  let guard = 0;
  while (!s.over && guard++ < 60) {
    for (let i = 0; i < 20 && s.pending; i++) combatAct(s, autoAnswer(s));
    if (s.over) break;
    // playTurn ends the turn itself; only force an end if the AI got stuck on the same turn
    const turn = s.turn;
    playTurn(s);
    for (let i = 0; i < 20 && s.pending; i++) combatAct(s, autoAnswer(s));
    if (s.phase === 'main' && !s.over && s.turn === turn) combatAct(s, { type: 'endTurn' });
  }
  if (!s.over) s.over = 'lose';
  const pc = commanderOf(s, 'player');
  const e = (encStat[encId] ??= { fights: 0, deaths: 0, turns: 0, hpLost: 0 });
  e.fights++; e.turns += s.turn;
  e.hpLost += Math.max(0, hp0 - (pc?.hp ?? 0));
  if (s.over === 'lose') e.deaths++;
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
        const take = best && (r.deck.length < 26 || score(best.o.id) >= 3);
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
      const cands = pickCandidates(r, sc.kind);
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
  for (let i = 0; i < RUNS; i++) {
    const seed = `sim-${cmd}-${ASC}-${i}`;
    const r = newRun({ seed, commander: cmd, ascension: ASC, unlockedHidden: false });
    let guard = 0;
    try {
      while (guard++ < 3000 && step(r)) { /* */ }
    } catch (e) { errors.push(`${seed}: ${(e as Error).message}`); r.result = 'lose'; }
    const win = r.result === 'win';
    const st = (byCmd[cmd] ??= { n: 0, wins: 0, floors: 0 });
    st.n++; if (win) st.wins++; st.floors += r.stats.floors;
    actReached[r.act] = (actReached[r.act] ?? 0) + 1;
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
md.push(`## 总体`, '', `胜率 ${pct(totalWins, totalRuns)} · 到达幕数：${Object.entries(actReached).sort().map(([a, n]) => `第${a}幕 ${pct(n, totalRuns)}`).join(' / ')}`, '');
md.push('## 主帅', '', '| 主帅 | 局数 | 胜率 | 平均到达层数 |', '|---|---|---|---|');
for (const [id, v] of Object.entries(byCmd)) md.push(`| ${c.commander(id).name} | ${v.n} | ${pct(v.wins, v.n)} | ${(v.floors / v.n).toFixed(1)} |`);
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
fs.writeFileSync('.cache/sim/report.json', JSON.stringify({ byCmd, encs, deckRate, relics, errors }, null, 1));
if (!args.noReport) fs.writeFileSync('docs/平衡报告.md', md.join('\n') + '\n');
console.log(`done: ${totalWins}/${totalRuns} wins, ${combatsTotal} combats, ${errors.length} errors`);
for (const e of errors.slice(0, 10)) console.log('ERR', e);
