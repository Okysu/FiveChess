/**
 * Parity traces for the Godot port (godot/engine). Runs the TS engine through the simulator's policy
 * (scripts/sim-policy.ts: greedy autoplay bot + run heuristics) and records, after EVERY successful action,
 * a canonical serialization of the combat / run state plus the emitted combat events.
 *   npx tsx scripts/export-parity.ts [--combats=8] [--runs=2] [--simSeeds=b_shiyun:1,...] [--maxSteps=4000] [--asc=0,8,14] [--noVerify] [--out=godot/tests/parity]
 * then: godot --headless --path godot --script res://tests/run_parity.gd   (see godot/README.md)
 * It also re-syncs godot/data (scripts/sync-godot-data.ts) so both engines read the same content.
 *
 * Case files (godot/tests/parity/<name>.json, listed in manifest.json with a coverage summary):
 *   combat_<cmd>_<k>  { kind:'combat', name, cfg, steps }         one bot-played fight (all encounters covered)
 *   run_<cmd>_<k>     { kind:'run', name, opts, truncated, steps } a full run with the simulator policy
 *   run_sim_<cmd>_<i> same, on balance-simulator seeds that reach acts 3-4 / win
 * Steps (k = kind):
 *   newRun  { opts, st }                               run created (run cases)
 *   start   { cfg, st, ev }                            createCombat(cfg) (+ events of combat start)
 *   act     { src, a, d, ev }                          combat act() that succeeded; src = sim-policy ActSrc
 *   lose    { d }                                      fight hit the 60-turn cap (state forced to 'lose')
 *   run     { a, d }                                   runAct() that succeeded
 *   mark    { i, d }                                   reward potion skipped with full slots (direct edit)
 *   meta    { summary, unlocked, profile, locked, next } meta.ts after the run (profile chained over run cases)
 *   error   { message }                                the policy threw (the case stops here)
 * `st` is a full canonical state; `d` is a patch against the previous state of the same layer (combat / run):
 * [[path]] deletes a key, [[path], value] sets it (arrays that change length are replaced whole).
 * Canonical form: object keys sorted, undefined/null-valued keys dropped, arrays keep nulls, integers as JSON numbers,
 * non-integers as "#f<IEEE-754 bits in hex>" (bit-exact, independent of JSON float parsing);
 * combat state omits events/log/actions/cfg (adds nActions), run state omits log (adds nLog).
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadContent } from './load-content';
import { syncGodotData } from './sync-godot-data';
import { act, createCombat } from '../src/engine/combat/api';
import type { CombatConfig, CombatState, PlayerAction } from '../src/engine/combat/state';
import { newRun, runAct, type RunState, type RunAction, type RunOpts } from '../src/engine/run/run';
import { content } from '../src/engine/content';
import { seedRng, rand, sample, pick } from '../src/engine/rng';
import { newProfile, lockedContent, recordRun, runScore, nextUnlock, type RunSummary } from '../src/engine/meta';
import { defaultIO, fightLoop, playTurnVia, step, type ActSrc, type SimIO } from './sim-policy';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k!, v ?? 'true']; }));
const COMBATS = Number(args.combats ?? 8);
const RUNS = Number(args.runs ?? 2);
const MAX_STEPS = Number(args.maxSteps ?? 4000);
const VERIFY = !args.noVerify;
/** extra full runs on balance-simulator seeds (cmd:i → seed sim-<cmd>-0-<i>), chosen because the bot gets far */
const SIM_SEEDS: string[] = args.simSeeds === '' ? [] : (args.simSeeds ?? 'b_shiyun:1,y_yanwujiu:0,b_suxian:2').split(',');
const ROOT = path.resolve(import.meta.dirname ?? __dirname, '..');
const OUT = path.resolve(ROOT, args.out ?? 'godot/tests/parity');

loadContent();
syncGodotData();
const c = content();

// ───────────── canonical serialization ─────────────

const f64 = new Float64Array(1);
const f64b = new Uint8Array(f64.buffer);
/** non-integer numbers travel as their exact IEEE-754 bits ("#f" + 16 hex digits, big-endian): JSON text round-trips
 *  through Godot's parser are not guaranteed to be correctly rounded, the bits are */
export function fbits(v: number): string {
  f64[0] = v;
  let h = "";
  for (let i = 7; i >= 0; i--) h += f64b[i]!.toString(16).padStart(2, "0");
  return `#f${h}`;
}

export function canon(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return 'NaN';
    if (!Number.isFinite(v)) return v > 0 ? 'Infinity' : '-Infinity';
    if (Number.isInteger(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER) return v === 0 ? 0 : v;
    return fbits(v);
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
/** what the traces exercise (printed + stored in the manifest) */
const coverage: Record<string, Record<string, number>> = { events: {}, decisions: {}, actions: {}, runActions: {}, screens: {}, encounters: {} };
const tally = (k: string, v: string) => { const m = coverage[k]!; m[v] = (m[v] ?? 0) + 1; };


function recordingIO(steps: Step[]): SimIO {
  return {
    createCombat(cfg: CombatConfig) {
      const s = createCombat(cfg);
      steps.push({ k: 'start', cfg: canon(cfg), st: canonCombat(s), ev: canon(s.events) });
      tally('encounters', cfg.encounter);
      for (const e of s.events) tally('events', e.t);
      return s;
    },
    combatAct(s: CombatState, a: PlayerAction, src: ActSrc) {
      const r = act(s, a);
      if (r.ok) {
        steps.push({ k: 'act', src, a: canon(a), st: canonCombat(s), ev: canon(r.events) });
        tally('actions', a.type);
        for (const e of r.events) tally('events', e.t);
        if (s.pending) tally('decisions', s.pending.kind);
      }
      return r;
    },
    playTurn: (s, io) => playTurnVia(s, io),
    runAct(r: RunState, a: RunAction) {
      const err = runAct(r, a);
      if (!err) { steps.push({ k: 'run', a: canon(a), st: canonRun(r) }); tally('runActions', a.t); tally('screens', r.screen.k); }
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

// ───────────── delta encoding (keeps the trace files small) ─────────────

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type PatchOp = [(string | number)[]] | [(string | number)[], Json];

function jsonEq(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as Json[];
    if (a.length !== bb.length) return false;
    for (let i = 0; i < a.length; i++) if (!jsonEq(a[i]!, bb[i]!)) return false;
    return true;
  }
  const ao = a as Record<string, Json>, bo = b as Record<string, Json>;
  const ka = Object.keys(ao), kb = Object.keys(bo);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!(k in bo) || !jsonEq(ao[k]!, bo[k]!)) return false;
  return true;
}

/** ops turning `a` into `b`: [path] = delete key, [path, value] = set (arrays of a different length are replaced whole) */
function diffJson(a: Json, b: Json, path: (string | number)[] = [], out: PatchOp[] = []): PatchOp[] {
  if (jsonEq(a, b)) return out;
  const isObj = (x: Json) => typeof x === 'object' && x !== null && !Array.isArray(x);
  if (isObj(a) && isObj(b)) {
    const ao = a as Record<string, Json>, bo = b as Record<string, Json>;
    for (const k of Object.keys(ao)) if (!(k in bo)) out.push([[...path, k]]);
    for (const k of Object.keys(bo)) diffJson(k in ao ? ao[k]! : (undefined as unknown as Json), bo[k]!, [...path, k], out);
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    for (let i = 0; i < a.length; i++) diffJson(a[i]!, b[i]!, [...path, i], out);
    return out;
  }
  out.push([path, b]);
  return out;
}

/** replace `st` by `d` (a patch against the previous state of the same layer) everywhere but the first state */
function deltaEncode(steps: Step[]): Step[] {
  const last: Record<string, Json> = {};
  return steps.map((st) => {
    if (!('st' in st)) return st;
    const layer = st.k === 'start' || st.k === 'act' || st.k === 'lose' ? 'combat' : 'run';
    const cur = st.st as Json;
    const prev = last[layer];
    last[layer] = cur;
    if (st.k === 'start' || st.k === 'newRun' || prev === undefined) return st;
    const { st: _drop, ...rest } = st;
    void _drop;
    return { ...rest, d: diffJson(prev, cur) } as Step;
  });
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
    const bytes = writeCase(name, { kind: 'combat', name, cfg: canon(cfg), steps: deltaEncode(steps) });
    manifest.push({ name, kind: 'combat', steps: steps.length, actions: steps.filter((x) => x.k === 'act').length, bytes, result: `${s.over} t${s.turn} ${cfg.encounter}` });
  }
});

// full runs (+ meta chained over them, in manifest order)
const profile = newProfile();
function recordRunCase(name: string, opts: RunOpts, maxSteps: number) {
  const steps: Step[] = [];
  const io = recordingIO(steps);
  const r = newRun(JSON.parse(JSON.stringify(opts)));
  steps.push({ k: 'newRun', opts: canon(opts), st: canonRun(r) });
  let guard = 0;
  let truncated = false;
  try {
    while (guard++ < 3000 && step(r, io)) { if (steps.length >= maxSteps) { truncated = true; break; } }
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
  const bytes = writeCase(name, { kind: 'run', name, opts: canon(opts), truncated, steps: deltaEncode(steps) });
  manifest.push({ name, kind: 'run', steps: steps.length, actions: steps.filter((x) => x.k === 'act' || x.k === 'run').length, bytes, result: `${r.result ?? (truncated ? 'truncated' : '?')} act${r.act} floor${r.floor}` });
}

commanders.forEach((cmd, ci) => {
  for (let k = 0; k < RUNS; k++) {
    recordRunCase(`run_${cmd}_${k}`, { seed: `parity-r-${cmd}-${k}`, commander: cmd, ascension: (ci + k) % 3 === 0 ? 0 : ASCS[(ci + k) % ASCS.length]!, locked: lockedContent(profile), unlockedHidden: k % 2 === 1 }, MAX_STEPS);
  }
});
// seeds the balance simulator plays deep into acts 3-4 (incl. wins → hidden-boss choice, victory, win-side meta)
for (const spec of SIM_SEEDS) {
  const [cmd, i] = spec.split(':');
  recordRunCase(`run_sim_${cmd}_${i}`, { seed: `sim-${cmd}-0-${i}`, commander: cmd!, ascension: 0, unlockedHidden: true }, 20000);
}

fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ generated: 'scripts/export-parity.ts', combats: COMBATS, runs: RUNS, coverage, cases: manifest }, null, 1));
for (const [k, m] of Object.entries(coverage)) console.log(`  ${k} (${Object.keys(m).length}): ${Object.entries(m).sort((a, b) => b[1] - a[1]).map(([x, n]) => `${x}:${n}`).join(' ')}`);
const tot = manifest.reduce((a, m) => ({ steps: a.steps + m.steps, actions: a.actions + m.actions, bytes: a.bytes + m.bytes }), { steps: 0, actions: 0, bytes: 0 });
console.log(`parity: ${manifest.length} cases, ${tot.steps} steps, ${tot.actions} actions, ${(tot.bytes / 1e6).toFixed(1)} MB → ${path.relative(ROOT, OUT)} (${((Date.now() - t0) / 1000).toFixed(1)}s)${problems ? `, ${problems} PROBLEMS` : ''}`);
if (problems) process.exitCode = 1;
