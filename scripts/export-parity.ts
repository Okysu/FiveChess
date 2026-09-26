/**
 * Parity traces for the Godot port (godot/engine). Runs the TS engine through the simulator's policy
 * (scripts/sim-policy.ts: greedy autoplay bot + run heuristics) and records, after EVERY successful action,
 * a canonical serialization of the combat / run state plus the emitted combat events.
 *   npx tsx scripts/export-parity.ts [--combats=8] [--runs=1] [--maxSteps=4000] [--asc=...] [--noVerify] [--out=godot/tests/parity]
 * then: godot --headless --path godot --script res://tests/run_parity.gd   (see godot/README.md)
 *
 * Case files (godot/tests/parity/<name>.json):
 *   combat_*  { kind:'combat', name, cfg, steps }
 *   run_*     { kind:'run', name, opts, steps }
 * Steps (k = kind):
 *   newRun  { opts, st }                               run created (run cases)
 *   start   { cfg, st, ev }                            createCombat(cfg) (+ events of combat start)
 *   act     { src, a, st, ev }                         combat act() that succeeded; src = sim-policy ActSrc
 *   lose    { st }                                     fight hit the 60-turn cap (state forced to 'lose')
 *   run     { a, st }                                  runAct() that succeeded
 *   mark    { i, st }                                  reward potion skipped with full slots (direct edit)
 *   meta    { summary, unlocked, profile, locked, next } meta.ts after the run (profile chained over run cases)
 *   error   { message }                                the policy threw (the case stops here)
 * Canonical form: object keys sorted, undefined/null-valued keys dropped, arrays keep nulls, numbers as JSON;
 * combat state omits events/log/actions/cfg (adds nActions), run state omits log (adds nLog).
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadContent } from './load-content';
import { syncGodotData } from './sync-godot-data';
import { act, createCombat } from '../src/engine/combat/api';
import type { CombatConfig, CombatState, PlayerAction } from '../src/engine/combat/state';
import { newRun, runAct, type RunState, type RunAction } from '../src/engine/run/run';
import { content } from '../src/engine/content';
import { seedRng, rand, sample, pick } from '../src/engine/rng';
import { newProfile, lockedContent, recordRun, runScore, nextUnlock, type RunSummary } from '../src/engine/meta';
import { defaultIO, fightLoop, playTurnVia, step, type ActSrc, type SimIO } from './sim-policy';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k!, v ?? 'true']; }));
const COMBATS = Number(args.combats ?? 8);
const RUNS = Number(args.runs ?? 1);
const MAX_STEPS = Number(args.maxSteps ?? 4000);
const VERIFY = !args.noVerify;
const ROOT = path.resolve(import.meta.dirname ?? __dirname, '..');
const OUT = path.resolve(ROOT, args.out ?? 'godot/tests/parity');

loadContent();
syncGodotData();
const c = content();

// ───────────── canonical serialization ─────────────

export function canon(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return 'NaN';
    if (!Number.isFinite(v)) return v > 0 ? 'Infinity' : '-Infinity';
    return v === 0 ? 0 : v;
  }
  if (typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(canon);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v).sort()) {
    const x = canon((v as Record<string, unknown>)[k]);
    if (x !== null) out[k] = x;
  }
  return out;
}

export function canonCombat(s: CombatState): unknown {
  return canon({ ...s, events: undefined, log: undefined, actions: undefined, cfg: undefined, nActions: s.actions.length });
}

export function canonRun(r: RunState): unknown {
  return canon({ ...r, log: undefined, nLog: r.log.length });
}

// ───────────── recording IO ─────────────

type Step = Record<string, unknown> & { k: string };

function recordingIO(steps: Step[]): SimIO {
  return {
    createCombat(cfg: CombatConfig) {
      const s = createCombat(cfg);
      steps.push({ k: 'start', cfg: canon(cfg), st: canonCombat(s), ev: canon(s.events) });
      return s;
    },
    combatAct(s: CombatState, a: PlayerAction, src: ActSrc) {
      const r = act(s, a);
      if (r.ok) steps.push({ k: 'act', src, a: canon(a), st: canonCombat(s), ev: canon(r.events) });
      return r;
    },
    playTurn: (s, io) => playTurnVia(s, io),
    runAct(r: RunState, a: RunAction) {
      const err = runAct(r, a);
      if (!err) steps.push({ k: 'run', a: canon(a), st: canonRun(r) });
      return err;
    },
    markTaken(r: RunState, i: number) {
      defaultIO.markTaken(r, i);
      steps.push({ k: 'mark', i, st: canonRun(r) });
    },
    forceLose(s: CombatState) {
      defaultIO.forceLose(s);
      steps.push({ k: 'lose', st: canonCombat(s) });
    },
  };
}

// ───────────── case builders ─────────────

const commanders = [...c.commanders.keys()];
const encounters = [...c.encounters.keys()].filter((id) => id !== 'sandbox').sort();
const lieutenants = [...c.lieutenants.values()].map((l) => l.id).sort();
const relicPool = [...c.relics.values()].filter((r) => ['common', 'uncommon', 'rare', 'boss', 'shop', 'event'].includes(r.tier)).map((r) => r.id).sort();
const potionIds = [...c.potions.keys()].sort();
const ASCS = args.asc ? args.asc.split(',').map(Number) : [0, 8, 14, 3, 11, 5, 13, 7];

/** a combat config built from a fresh run of the commander, spiced with extra cards / relics / potions for coverage */
function combatCfg(cmd: string, ci: number, k: number): CombatConfig {
  const seed = `parity-c-${cmd}-${k}`;
  const asc = ASCS[k % ASCS.length]!;
  const r = newRun({ seed, commander: cmd, ascension: asc });
  const rng = seedRng(`${seed}/extra`);
  const faction = c.commander(cmd).faction;
  let lieutenant: string | null = null;
  if (k % 2 === 1) lieutenant = pick(rng, lieutenants.filter((id) => c.lieutenants.get(id)!.faction !== faction)) ?? null;
  const own = lieutenant ? [faction, c.lieutenants.get(lieutenant)!.faction] : [faction];
  const extra = sample(rng, c.filterCards({ faction: 'own' }, own), 7).map((d) => ({ id: d.id, up: !!d.upgrade && rand(rng) < 0.5 }));
  const relics = [...r.relics.map((x) => ({ ...x })), ...sample(rng, relicPool, 1 + (k % 3)).map((id) => ({ id, counter: 0 }))];
  const potions: (string | null)[] = [pick(rng, potionIds)!, pick(rng, potionIds)!, null];
  return {
    commander: cmd, lieutenant, hp: r.hp, maxHp: r.maxHp,
    deck: [...r.deck.map((d) => ({ id: d.id, up: d.up })), ...extra], relics, potions,
    fateDeck: r.fateDeck.map((f) => ({ ...f })), encounter: encounters[(k * commanders.length + ci) % encounters.length]!,
    ascension: asc, seed: `${seed}/combat`, emberCapBonus: k % 4 === 2 ? 1 : 0, extraStartSources: k % 4 === 3 ? [faction] : [],
  };
}

function writeCase(name: string, data: unknown): number {
  const json = JSON.stringify(data);
  fs.writeFileSync(path.join(OUT, `${name}.json`), json);
  return json.length;
}

fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.json')) fs.unlinkSync(path.join(OUT, f));

const manifest: { name: string; kind: string; steps: number; actions: number; bytes: number; result: string }[] = [];
let problems = 0;
const t0 = Date.now();

// combats
commanders.forEach((cmd, ci) => {
  for (let k = 0; k < COMBATS; k++) {
    const cfg = combatCfg(cmd, ci, k);
    const steps: Step[] = [];
    const io = recordingIO(steps);
    const s = io.createCombat(cfg);
    fightLoop(s, io);
    if (VERIFY) {
      const s2 = createCombat(JSON.parse(JSON.stringify(cfg)) as CombatConfig);
      fightLoop(s2, defaultIO);
      if (JSON.stringify(canonCombat(s2)) !== JSON.stringify(canonCombat(s))) { problems++; console.error(`VERIFY FAILED combat ${cmd} ${k}`); }
    }
    const name = `combat_${cmd}_${k}`;
    const bytes = writeCase(name, { kind: 'combat', name, cfg: canon(cfg), steps });
    manifest.push({ name, kind: 'combat', steps: steps.length, actions: steps.filter((x) => x.k === 'act').length, bytes, result: `${s.over} t${s.turn} ${cfg.encounter}` });
  }
});

// full runs (+ meta chained over them)
const profile = newProfile();
commanders.forEach((cmd, ci) => {
  for (let k = 0; k < RUNS; k++) {
    const opts = { seed: `parity-r-${cmd}-${k}`, commander: cmd, ascension: (ci + k) % 3 === 0 ? 0 : ASCS[(ci + k) % ASCS.length]!, locked: lockedContent(profile), unlockedHidden: k % 2 === 1 };
    const steps: Step[] = [];
    const io = recordingIO(steps);
    const r = newRun(JSON.parse(JSON.stringify(opts)));
    steps.push({ k: 'newRun', opts: canon(opts), st: canonRun(r) });
    let guard = 0;
    let truncated = false;
    try {
      while (guard++ < 3000 && step(r, io)) { if (steps.length >= MAX_STEPS) { truncated = true; break; } }
    } catch (e) { steps.push({ k: 'error', message: (e as Error).message }); problems++; console.error(`run ${opts.seed}: ${(e as Error).message}`); }
    if (VERIFY && !truncated) {
      // the plain simulator path (real autoplay.playTurn, no recording) must end in the identical run state
      const r2 = newRun(JSON.parse(JSON.stringify(opts)));
      let g2 = 0;
      try { while (g2++ < 3000 && step(r2, defaultIO)) { /* */ } } catch { /* the recorded run threw too */ }
      if (JSON.stringify(canonRun(r2)) !== JSON.stringify(canonRun(r))) { problems++; console.error(`VERIFY FAILED run ${opts.seed}`); }
    }
    if (!truncated && r.result) {
      const summary: RunSummary = {
        seed: r.seed, commander: r.commander, lieutenant: r.lieutenant, ascension: r.ascension, result: r.result, act: r.act, floor: r.floor,
        score: runScore(r), date: 0, deck: r.deck.map((d) => d.id), relics: r.relics.map((x) => x.id), nemesis: r.nemesis,
        turns: r.stats.turns, maxDamage: r.stats.maxDamage,
      };
      const unlocked = recordRun(profile, r, summary);
      steps.push({ k: 'meta', summary: canon(summary), unlocked, profile: canon(profile), locked: canon(lockedContent(profile)), next: canon(nextUnlock(profile)) });
    }
    const name = `run_${cmd}_${k}`;
    const bytes = writeCase(name, { kind: 'run', name, opts: canon(opts), steps });
    manifest.push({ name, kind: 'run', steps: steps.length, actions: steps.filter((x) => x.k === 'act' || x.k === 'run').length, bytes, result: `${r.result ?? (truncated ? 'truncated' : '?')} act${r.act} floor${r.floor}` });
  }
});

fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ generated: 'scripts/export-parity.ts', combats: COMBATS, runs: RUNS, cases: manifest }, null, 1));
const tot = manifest.reduce((a, m) => ({ steps: a.steps + m.steps, actions: a.actions + m.actions, bytes: a.bytes + m.bytes }), { steps: 0, actions: 0, bytes: 0 });
console.log(`parity: ${manifest.length} cases, ${tot.steps} steps, ${tot.actions} actions, ${(tot.bytes / 1e6).toFixed(1)} MB → ${path.relative(ROOT, OUT)} (${((Date.now() - t0) / 1000).toFixed(1)}s)${problems ? `, ${problems} PROBLEMS` : ''}`);
if (problems) process.exitCode = 1;
