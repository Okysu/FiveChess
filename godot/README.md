# 命阙 — Godot 4.7 rules engine port

A GDScript port of the pure-TypeScript rules engine in `src/engine` (combat, run layer, meta progression, greedy
bot) plus the balance simulator's play policy, kept **bit-exact** with the TS engine by a trace-based parity harness.
No rendering here — the web UI stays in `src/game`.

## Running

Godot 4.7 (self-contained install used here: `C:/Users/Okysu/SDK/godot/Godot_v4.7.2-stable_win64_console.exe`,
written `godot` below). All commands from the repo root.

```sh
# 0. once (and after adding/renaming a class_name script): build Godot's global class cache
godot --headless --path godot --import

# 1. content: copy src/data -> godot/data (+ _index.json). Idempotent; export-parity.ts runs it too.
npx tsx scripts/sync-godot-data.ts

# 2. record TS traces (default matrix: 10 commanders x 8 bot-played fights covering all 77 encounters,
#    10 x 2 full runs, 3 long runs on simulator seeds that reach act 4 / win; ~2 min, ~43 MB)
npx tsx scripts/export-parity.ts            # --combats=N --runs=N --simSeeds=cmd:i,... --maxSteps=N --noVerify

# 3. replay in Godot and compare after every action (~13 min for the default matrix; use --only for subsets)
godot --headless --path godot --script res://tests/run_parity.gd
godot --headless --path godot --script res://tests/run_parity.gd -- --mode=replay     # engine only
godot --headless --path godot --script res://tests/run_parity.gd -- --only=combat_y_,run_sim --max=5

# unit tests (rng vs known TS outputs, fillVars, damage calc, JS-semantics helpers)
godot --headless --path godot --script res://tests/run_unit.gd
```

Exit code is 0 only when everything matches. A divergence prints the step, the action, and the first differing
paths with both values, e.g.

```
FAIL run_b_suxian_0
step #412 k=act src=choose a={"card":81,"type":"play"}
  state (combat):
    $.units.7.hp: TS=12 GD=13
  events:
    $events[3].amount: TS=5 GD=6
```

### Harness modes

- **lockstep** (default): the GDScript bot and run policy (`MqSim` / `MqAuto`) drive the game on their own. Every
  action they take must equal the recorded TS action (same source tag: `choose`, `settle`, `answer`, `pass`, `end`,
  `aiError`), and the canonical state + emitted events must match after it. This proves engine *and* bot parity.
- **replay**: applies the recorded TS actions (engine-only parity, keeps going after bot differences) and still
  recomputes the bot's choice per step, reporting mismatches separately. Use it to tell engine bugs from bot bugs.

### Trace format

`scripts/export-parity.ts` documents it in its header. In short: one JSON file per case, steps
`newRun | start | act | lose | run | mark | meta | error`; the first state of each layer is stored in full (`st`),
later ones as a patch (`d`) against the previous state. Canonical form: sorted keys, `undefined`/`null`-valued keys
dropped, integers as numbers, non-integers as `"#f" + IEEE-754 bits` (Godot's JSON parser is not correctly
rounded, bits are exact). Combat states omit `events/log/actions/cfg`, run states omit `log`.

## Module map (TS → GDScript)

| TypeScript | GDScript | class |
|---|---|---|
| `src/engine/rng.ts` | `engine/rng.gd` | `MqRng` |
| `src/engine/defs.ts` | `engine/defs.gd` (shape docs + constants) | `MqDefs` |
| `src/engine/content.ts`, `src/data/index.ts`, `scripts/load-content.ts` | `engine/content.gd` (static registry) | `MqContent` |
| `src/engine/glossary.ts` (rules data, `fillVars`, `plainRules`) | `engine/glossary.gd` | `MqGloss` |
| `src/engine/combat/state.ts` | `engine/combat/state.gd` (shape docs, `other`) | `MqState` |
| `src/engine/combat/board.ts` | `engine/combat/board.gd` | `MqBoard` |
| `src/engine/combat/eval.ts` | `engine/combat/eval.gd` | `MqEval` |
| `src/engine/combat/core.ts` | `engine/combat/core.gd` | `MqCore` |
| `src/engine/combat/api.ts` | `engine/combat/api.gd` | `MqApi` |
| `src/engine/combat/intents.ts` | `engine/combat/intents.gd` | `MqIntents` |
| `src/engine/combat/enemycast.ts` | `engine/combat/enemycast.gd` | `MqCast` |
| `src/engine/combat/skills.ts` | `engine/combat/skills.gd` | `MqSkills` |
| `src/engine/combat/tuning.ts` | `engine/combat/tuning.gd` | `MqTuning` |
| `src/engine/combat/autoplay.ts` | `engine/combat/autoplay.gd` | `MqAuto` |
| `src/engine/run/map.ts` | `engine/run/map.gd` | `MqMap` |
| `src/engine/run/run.ts` | `engine/run/run.gd` | `MqRun` |
| `src/engine/meta.ts` | `engine/meta.gd` | `MqMeta` |
| `scripts/sim-policy.ts` (policy extracted from `scripts/simulate.ts`) | `engine/sim/sim_policy.gd` | `MqSim` |
| — (JS semantics helpers) | `engine/util.gd` | `MqU` |
| `scripts/export-parity.ts` canon / delta | `tests/parity_lib.gd` | `MqParity` |

Function names follow the TS ones in snake_case (`createCombat` → `MqApi.create_combat`, `playableInfo` →
`playable_info`, `chooseAction` → `MqAuto.choose_action`, `runAct` → `MqRun.run_act`, ...). Each file starts with a
comment naming its TS source. `schema.ts` (zod validation) has no runtime role and is not ported; content is
validated on the TS side (`npm run validate`).

Usage from game code:

```gdscript
MqContent.load_all()
var s := MqApi.create_combat(cfg)          # cfg: same shape as the TS CombatConfig
var res := MqApi.act(s, {"type": "endTurn"})  # -> {ok, error?, events}
var r := MqRun.new_run({"seed": "abc", "commander": "r_huojin", "ascension": 0})
MqRun.run_act(r, {"t": "proceed"})          # -> null or an error string
```

## Conventions (and the determinism traps they handle)

- **State is JSON-like**: Dictionaries / Arrays with the TS field names, so it serializes and diffs directly against
  TS state. Unit ids are `int` Dictionary keys (`s.units[uid]`); the canonical serializer stringifies keys.
- **Numbers**: `JSON.parse_string` yields only floats, so all loaded JSON goes through `MqU.json_norm` (integral
  floats → int, like JS numbers). Integer-valued stats stay `int`; anywhere JS divides, the port uses
  `MqU.fdiv` (GDScript `int / int` truncates), `MqU.floori` for `Math.floor`, `MqU.js_round` for `Math.round`
  (half-up toward +∞, unlike GDScript's `round`). Float expressions (damage multipliers, tuning, bot evaluation,
  map layout) keep the TS operation order so the doubles are identical.
- **32-bit RNG**: sfc32 / cyrb128 keep every value as an unsigned 32-bit pattern (`& 0xFFFFFFFF`), `>>>` is a plain
  shift of the masked value, `Math.imul` is a split 16-bit multiply; `charCodeAt` is emulated with UTF-16 code units.
- **Sorting**: JS `Array.prototype.sort` is stable; `MqU.stable_sort` is a merge sort taking a JS-style comparator
  (`MqU.cmp_or` expresses `a || b` chains). `sort()` without comparator → `MqU.default_sort` (string compare).
  `localeCompare` on content ids → `MqContent.locale_compare`, backed by the rank table that
  `scripts/sync-godot-data.ts` computes with the real `localeCompare` (currently identical to code-point order).
- **Iteration order**: Dictionaries keep insertion order like JS objects / Maps; content is loaded in the TS bundle
  file order (`_index.json.files`), and code inserts keys in the TS order. (JS orders integer-like object keys
  numerically; `units` are inserted with increasing uids so insertion order equals that.)
- **undefined / null / missing**: optional fields are either absent or `null`; read them with `.get()` and test
  presence with `!= null`, never truthiness — `{}` and `[]` are falsy in GDScript but truthy in JS
  (`MqU.truthy` mirrors JS truthiness for primitives). `a ?? b` is `MqU.nz(a, b)` only when `b` has no side effects
  (it is evaluated eagerly); RNG-consuming fallbacks are written as explicit `if`s. `arr[i]` for a possibly
  out-of-range index is `MqU.at` (GDScript `arr[-1]` reads the last element).
- **Identity**: GDScript `==` / `Array.find` / `has` compare Dictionaries by value; JS `indexOf` on objects is
  identity → `MqU.idx_same` (`is_same`).
- **structuredClone** → `MqAuto.clone_state` (deep `duplicate(true)`, sharing the immutable `cfg`); it re-links the
  single aliasing the engine relies on (a pending rejudge decision's effect is the effect object inside its task).
- **Exceptions**: TS `throw` → `MqCore.fail()` sets `MqCore.abort` so `run()` stops; the two TS `try/catch` sites
  (enemy card look-ahead, intent preview) restore it. The parity harness reports any engine error raised.

## Known gaps

- Only the rules engine is ported; no scenes/UI. `schema.ts` validation and the art/audio pipelines are TS-only.
- `glossary.gd` carries the rules-relevant tables (names, suits, colors, `fill_vars`, `plain_rules`), not the long
  keyword/status description texts used by the web tooltips.
- A TS `throw` aborts mid-effect; the GD port finishes the current effect with a neutral value before stopping.
  Content never triggers this (the harness prints a counter if it happens).
- Traces must be regenerated after any content or engine change (`godot/tests/parity` is generated, not committed).
