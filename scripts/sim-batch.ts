/**
 * Parallel balance sweep: runs scripts/simulate.ts once per (ascension, commander) in child processes,
 * then merges the per-run records into one summary (act completion, per commander, per encounter).
 *   npx tsx scripts/sim-batch.ts [--runs=12] [--asc=0,5,10,15] [--commanders=a,b] [--jobs=20] [--chunk=6] [--tag=base] [--patch=what-if.mjs] [--commonSeeds]
 * Writes .cache/sim/batch-<tag>.json and prints markdown tables (used for docs/难度评估.md).
 */
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { loadContent } from './load-content';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k!, v ?? 'true']; }));
const RUNS = Number(args.runs ?? 12);
const ASCS = String(args.asc ?? '0').split(',').map(Number);
const JOBS = Number(args.jobs ?? 20);
const TAG = String(args.tag ?? 'batch');
const c = loadContent();
const commanders = args.commanders ? String(args.commanders).split(',') : [...c.commanders.keys()];
fs.mkdirSync('.cache/sim', { recursive: true });

interface FightRec { enc: string; act: number; tier: string; hp0: number; hp1: number; maxHp: number; turns: number; win: boolean }
interface RunRec { cmd: string; asc: number; seed: string; win: boolean; act: number; floors: number; bossActs: number[]; died: string | null; fights: FightRec[] }

const CHUNK = Number(args.chunk ?? 6);
const jobs = ASCS.flatMap((asc) => commanders.flatMap((cmd) => Array.from({ length: Math.ceil(RUNS / CHUNK) }, (_, k) => ({ asc, cmd, from: k * CHUNK, n: Math.min(CHUNK, RUNS - k * CHUNK), out: `.cache/sim/part-${TAG}-${asc}-${cmd}-${k}.json` }))));
const t0 = Date.now();

async function runAll() {
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const j = jobs[next++]!;
      await new Promise<void>((res, rej) => {
        const p = spawn(process.execPath, ['--import', 'tsx', 'scripts/simulate.ts', `--runs=${j.n}`, `--from=${j.from}`, `--asc=${j.asc}`, `--commanders=${j.cmd}`, '--noReport', `--out=${j.out}`, ...(args.patch ? [`--patch=${args.patch}`] : []), ...(args.commonSeeds ? ['--commonSeeds'] : [])], { stdio: ['ignore', 'ignore', 'inherit'] });
        p.on('exit', (code) => (code === 0 ? res() : rej(new Error(`${j.cmd}@${j.asc} exited ${code}`))));
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(JOBS, jobs.length) }, worker));
}

await runAll();
const runs: RunRec[] = jobs.flatMap((j) => (JSON.parse(fs.readFileSync(j.out, 'utf8')) as { runs: RunRec[] }).runs);
fs.writeFileSync(`.cache/sim/batch-${TAG}.json`, JSON.stringify({ runs }));

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(0)}%` : '—');
const cleared = (rs: RunRec[], a: number) => rs.filter((x) => x.win || x.act > a).length;
const bossSeen = (rs: RunRec[], a: number) => rs.filter((x) => x.bossActs.includes(a)).length;
const out: string[] = [];
out.push(`# sim batch ${TAG} · ${RUNS} runs × ${commanders.length} commanders · ${((Date.now() - t0) / 1000).toFixed(0)}s`, '');
out.push('| 逆命 | 局数 | 通关1幕 | 通关2幕 | 到3幕首领 | 通关3幕 | 胜利 | 平均层数 |', '|---|---|---|---|---|---|---|---|');
for (const asc of ASCS) {
  const rs = runs.filter((r) => r.asc === asc);
  out.push(`| ${asc} | ${rs.length} | ${pct(cleared(rs, 1), rs.length)} | ${pct(cleared(rs, 2), rs.length)} | ${pct(bossSeen(rs, 3), rs.length)} | ${pct(cleared(rs, 3), rs.length)} | ${pct(rs.filter((r) => r.win).length, rs.length)} | ${(rs.reduce((s, r) => s + r.floors, 0) / rs.length).toFixed(1)} |`);
}
for (const asc of ASCS) {
  const rs = runs.filter((r) => r.asc === asc);
  const mean = rs.reduce((s, r) => s + r.floors, 0) / rs.length;
  out.push('', `## 逆命 ${asc} · 主帅`, '', '| 主帅 | 通关1幕 | 通关2幕 | 到3幕首领 | 胜利 | 平均层数 | 相对均值 |', '|---|---|---|---|---|---|---|');
  for (const cmd of commanders) {
    const cr = rs.filter((r) => r.cmd === cmd);
    if (!cr.length) continue;
    const f = cr.reduce((s, r) => s + r.floors, 0) / cr.length;
    out.push(`| ${c.commander(cmd).name} | ${pct(cleared(cr, 1), cr.length)} | ${pct(cleared(cr, 2), cr.length)} | ${pct(bossSeen(cr, 3), cr.length)} | ${pct(cr.filter((r) => r.win).length, cr.length)} | ${f.toFixed(1)} | ${(((f - mean) / mean) * 100).toFixed(0)}% |`);
  }
  const enc: Record<string, { n: number; d: number; hp: number; pctHp: number; turns: number; tier: string; act: number }> = {};
  for (const r of rs) for (const f of r.fights) {
    const e = (enc[f.enc] ??= { n: 0, d: 0, hp: 0, pctHp: 0, turns: 0, tier: f.tier, act: f.act });
    e.n++; if (!f.win) e.d++; e.hp += Math.max(0, f.hp0 - f.hp1); e.pctHp += Math.max(0, f.hp0 - f.hp1) / f.maxHp; e.turns += f.turns;
  }
  out.push('', `## 逆命 ${asc} · 按幕/层级（每场平均失血占上限%）`, '', '| 幕 | 层级 | 场次 | 死亡率 | 平均失血 | 失血% | 平均回合 |', '|---|---|---|---|---|---|---|');
  for (const act of [1, 2, 3, 4]) for (const tier of ['normal', 'elite', 'boss']) {
    const es = Object.values(enc).filter((e) => e.act === act && e.tier === tier);
    const n = es.reduce((s, e) => s + e.n, 0);
    if (!n) continue;
    out.push(`| ${act} | ${tier} | ${n} | ${pct(es.reduce((s, e) => s + e.d, 0), n)} | ${(es.reduce((s, e) => s + e.hp, 0) / n).toFixed(1)} | ${pct(es.reduce((s, e) => s + e.pctHp, 0), n)} | ${(es.reduce((s, e) => s + e.turns, 0) / n).toFixed(1)} |`);
  }
  out.push('', `## 逆命 ${asc} · 遭遇战（场次≥3，按死亡率）`, '', '| 遭遇战 | 幕 | 层级 | 场次 | 死亡率 | 平均失血 | 平均回合 |', '|---|---|---|---|---|---|---|');
  for (const [id, e] of Object.entries(enc).filter(([, e]) => e.n >= 3).sort((a, b) => b[1].d / b[1].n - a[1].d / a[1].n || b[1].hp / b[1].n - a[1].hp / a[1].n)) {
    out.push(`| ${id} | ${e.act} | ${e.tier} | ${e.n} | ${pct(e.d, e.n)} | ${(e.hp / e.n).toFixed(1)} | ${(e.turns / e.n).toFixed(1)} |`);
  }
}
fs.writeFileSync(`.cache/sim/batch-${TAG}.md`, out.join('\n') + '\n');
console.log(out.join('\n'));
