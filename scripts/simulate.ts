/**
 * Balance simulator: plays full adventures with the greedy combat AI and simple run heuristics.
 *   npm run sim -- [--runs=40] [--asc=0] [--commanders=r_huojin,b_shiyun] [--verbose] [--noReport] [--out=.cache/sim/x.json]
 * Writes docs/平衡报告.md and .cache/sim/report.json (or --out). The JSON carries per-run records
 * (fights, act reached, cause of death) so several processes' outputs can be merged (scripts/sim-merge.ts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadContent } from './load-content';
import { aiErrors } from '../src/engine/combat/autoplay';
import { newRun, type RunState } from '../src/engine/run/run';
import { content } from '../src/engine/content';
import { commanderOf } from '../src/engine/combat/board';
import { BY_ACT_TIER, BY_ENCOUNTER } from '../src/engine/combat/tuning';
import { defaultIO, step as policyStep, type SimHooks } from './sim-policy';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k!, v ?? 'true']; }));
const RUNS = Number(args.runs ?? 20);
const FROM = Number(args.from ?? 0);
const ASC = Number(args.asc ?? 0);
loadContent();
const c = content();
// --patch=file.mjs: a module whose default export mutates the loaded content in memory (what-if experiments)
if (args.patch) { const { pathToFileURL } = await import('node:url'); const m = await import(pathToFileURL(path.resolve(args.patch)).href); m.default(c); }
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

let stalls = 0;
/** stats only — every decision lives in scripts/sim-policy.ts (shared with the Godot parity exporter) */
const hooks: SimHooks = {
  traceFloor: args.trace !== undefined ? Number(args.trace) : undefined,
  debug: !!args.debug,
  onStall: () => { stalls++; },
  onCardOffer: (options, picked) => {
    for (const o of options) (cardSeen[o.id] ??= { offered: 0, picked: 0, inWinningDecks: 0, inDecks: 0 }).offered++;
    if (picked) cardSeen[picked]!.picked++;
  },
  onFightEnd: ({ r, s, encId, hp0, guard }) => {
    const pc = commanderOf(s, 'player');
    const e = (encStat[encId] ??= { fights: 0, deaths: 0, turns: 0, hpLost: 0 });
    e.fights++; e.turns += s.turn;
    e.hpLost += Math.max(0, hp0 - (pc?.hp ?? 0));
    if (s.over === 'lose') e.deaths++;
    const sc0 = r.screen.k === 'combat' ? r.screen : null;
    curFights.push({ enc: encId, act: r.act, tier: sc0?.tier ?? '?', hp0, hp1: pc?.hp ?? 0, maxHp: r.maxHp, turns: s.turn, win: s.over === 'win', dealt: s.stats.damageDealt, deck: r.deck.length });
    if (args.verbose) console.log(`  act${r.act} f${r.floor} ${encId.padEnd(22)} hp ${hp0}→${pc?.hp ?? 0}/${r.maxHp} turns ${s.turn} ${s.over}${guard >= 60 ? ' (TURN CAP)' : ''} deck ${r.deck.length}`);
    combatsTotal++;
  },
};
const step = (r: RunState) => policyStep(r, defaultIO, hooks);

for (const cmd of commanders) {
  for (let i = FROM; i < FROM + RUNS; i++) {
    // --commonSeeds: the same seeds at every ascension (common random numbers → cleaner difficulty-curve comparisons)
    const seed = args.commonSeeds ? `sim-${cmd}-${i}` : `sim-${cmd}-${ASC}-${i}`;
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
