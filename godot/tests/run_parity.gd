## Parity harness: replays the traces written by `npx tsx scripts/export-parity.ts` (res://tests/parity/*.json)
## and compares, after every action, the canonical combat / run state and the emitted events with the TS engine.
##
##   godot --headless --path godot --script res://tests/run_parity.gd [-- options]
##     --mode=lockstep   (default) the GDScript bot + run policy (MqSim / MqAuto) drive the game themselves; every
##                       action they take must equal the recorded TS action, and state/events must match after it
##     --mode=replay     apply the recorded TS actions (engine-only parity); the bot's choice is still recomputed
##                       per step and mismatches are counted separately
##     --only=<substr>   only cases whose name contains substr (comma-separated list allowed)
##     --max=<n>         at most n cases
##     --keep-going      do not stop a case at its first divergence in replay mode (lockstep always stops)
## Exit code 0 when every case matches.
extends SceneTree

var mode := "lockstep"
var only: Array = []
var max_cases := 1 << 30
var keep_going := false

var total_steps := 0
var total_actions := 0
var bot_checks := 0
var bot_mismatch := 0
var failures: Array = []
var profile: Dictionary
var profile_valid := true

func _init() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--mode="):
			mode = a.substr(7)
		elif a.begins_with("--only="):
			only = a.substr(7).split(",")
		elif a.begins_with("--max="):
			max_cases = int(a.substr(6))
		elif a == "--keep-going":
			keep_going = true
	var t0 = Time.get_ticks_msec()
	MqContent.load_all()
	var manifest = MqU.read_json("res://tests/parity/manifest.json")
	if manifest == null:
		printerr("no parity traces: run `npx tsx scripts/export-parity.ts` first")
		quit(2)
		return
	profile = MqMeta.new_profile()
	profile_valid = only.is_empty()
	var n = 0
	var passed = 0
	for c in manifest.cases:
		if not only.is_empty():
			var hit = false
			for o in only:
				if String(c.name).contains(o):
					hit = true
			if not hit:
				continue
		if n >= max_cases:
			break
		n += 1
		var data = MqU.read_json("res://tests/parity/%s.json" % c.name)
		var ct = Time.get_ticks_msec()
		var err = ""
		if mode == "replay":
			err = replay_case(data)
		else:
			err = lockstep_case(data)
		var ms = Time.get_ticks_msec() - ct
		if err == "":
			passed += 1
			print("PASS %-28s %5d steps  %6.1fs" % [c.name, data.steps.size(), ms / 1000.0])
		else:
			failures.append({"name": c.name, "err": err})
			print("FAIL %-28s %6.1fs\n%s" % [c.name, ms / 1000.0, err])
	print("")
	print("parity (%s): %d/%d cases match, %d steps / %d actions compared, %.1fs" % [mode, passed, n, total_steps, total_actions, (Time.get_ticks_msec() - t0) / 1000.0])
	if mode == "replay":
		print("bot choices recomputed: %d, mismatching: %d" % [bot_checks, bot_mismatch])
	if MqCore.err_count > 0:
		print("engine errors raised (TS would have thrown): %d, last: %s" % [MqCore.err_count, MqCore.last_err])
	quit(0 if failures.is_empty() and n > 0 else 1)

# ───────────── shared checks ─────────────

## compare a step's recorded state (full `st` or patch `d`) against `actual`; `holder` keeps the expected state per layer
func check_state(holder: Dictionary, layer: String, step: Dictionary, actual) -> String:
	if step.has("st"):
		holder[layer] = step.st
	else:
		holder[layer] = MqParity.apply_patch(holder[layer], step.d)
	var d = MqParity.diff(holder[layer], actual)
	if d.is_empty():
		return ""
	return "  state (%s):\n    %s" % [layer, "\n    ".join(d)]

func check_events(step: Dictionary, events: Array) -> String:
	if not step.has("ev"):
		return ""
	var d = MqParity.diff(step.ev, MqParity.canon(events), "$events")
	if d.is_empty():
		return ""
	return "  events:\n    %s" % "\n    ".join(d)

func where(i: int, step: Dictionary) -> String:
	var a = step.get("a")
	return "step #%d k=%s%s%s" % [i, step.k, (" src=" + step.src) if step.has("src") else "", (" a=" + MqParity.short(a, 300)) if a != null else ""]

func check_meta(r: Dictionary, step: Dictionary) -> String:
	var summary = {
		"seed": r.seed, "commander": r.commander, "lieutenant": r.lieutenant, "ascension": r.ascension, "result": r.result, "act": r.act, "floor": r.floor,
		"score": MqMeta.run_score(r), "date": 0, "deck": r.deck.map(func(d): return d.id), "relics": r.relics.map(func(x): return x.id), "nemesis": r.get("nemesis"),
		"turns": r.stats.turns, "maxDamage": r.stats.maxDamage,
	}
	var got = {"summary": MqParity.canon(summary)}
	if profile_valid:
		var unlocked = MqMeta.record_run(profile, r, summary)
		got.unlocked = unlocked
		got.profile = MqParity.canon(profile)
		got.locked = MqParity.canon(MqMeta.locked_content(profile))
		got.next = MqParity.canon(MqMeta.next_unlock(profile))
	var exp = {"summary": step.summary}
	if profile_valid:
		exp.unlocked = step.unlocked
		exp.profile = step.profile
		exp.locked = step.locked
		exp.next = step.get("next")
	var d = MqParity.diff(exp, got, "$meta")
	return "" if d.is_empty() else "  meta:\n    " + "\n    ".join(d)

func run_opts(data: Dictionary) -> Dictionary:
	# the exporter passed lockedContent(profile) of its own profile chain; the recorded opts are authoritative
	return data.opts.duplicate(true)

# ───────────── lockstep: GD bot + policy drive, TS trace checks ─────────────

class LockIO:
	extends RefCounted
	var h  # harness
	var steps: Array
	var idx = 0
	var failed = ""
	var expected = {}
	var actions = 0

	func _next(kind: String):
		if failed != "":
			return null
		if idx >= steps.size():
			failed = "GD produced an extra '%s' step after the TS trace ended (step #%d)" % [kind, idx]
			return null
		var st: Dictionary = steps[idx]
		idx += 1
		if st.k != kind:
			failed = "step #%d: TS recorded '%s' but GD produced '%s'\n  TS %s" % [idx - 1, st.k, kind, h.where(idx - 1, st)]
			return null
		return st

	func _fail(step: Dictionary, msg: String) -> void:
		if failed == "":
			failed = "%s\n%s" % [h.where(idx - 1, step), msg]

	func create_combat(cfg: Dictionary) -> Dictionary:
		var s = MqApi.create_combat(cfg)
		var st = _next("start")
		if st == null:
			s.over = "lose"
			return s
		var d = MqParity.diff(st.cfg, MqParity.canon(cfg), "$cfg")
		if not d.is_empty():
			_fail(st, "  cfg:\n    " + "\n    ".join(d))
		var e: String = h.check_state(expected, "combat", st, MqParity.canon_combat(s)) + h.check_events(st, s.events)
		if e != "":
			_fail(st, e)
		if failed != "":
			s.over = "lose"
		return s

	func combat_act(s: Dictionary, a: Dictionary, src: String) -> Dictionary:
		if failed != "":
			s.over = "lose"
			return {"ok": false, "error": "aborted", "events": []}
		var r = MqApi.act(s, a)
		if not r.ok:
			return r
		actions += 1
		var st = _next("act")
		if st == null:
			s.over = "lose"
			return r
		var msg = ""
		var ad = MqParity.diff(st.a, MqParity.canon(a), "$action")
		if st.src != src or not ad.is_empty():
			msg += "  bot action differs: TS src=%s a=%s | GD src=%s a=%s\n" % [st.src, MqParity.short(st.a), src, MqParity.short(MqParity.canon(a))]
		msg += h.check_state(expected, "combat", st, MqParity.canon_combat(s)) + h.check_events(st, r.events)
		if msg != "":
			_fail(st, msg)
			s.over = "lose"
		return r

	func play_turn(s: Dictionary, io) -> void:
		MqSim.play_turn_via(s, io)

	func run_act(r: Dictionary, a: Dictionary):
		if failed != "":
			return "aborted"
		var err = MqRun.run_act(r, a)
		if err != null:
			return err
		actions += 1
		var st = _next("run")
		if st == null:
			return "aborted"
		var msg = ""
		var ad = MqParity.diff(st.a, MqParity.canon(a), "$action")
		if not ad.is_empty():
			msg += "  run action differs:\n    " + "\n    ".join(ad) + "\n"
		msg += h.check_state(expected, "run", st, MqParity.canon_run(r))
		if msg != "":
			_fail(st, msg)
			return "aborted"
		return null

	func mark_taken(r: Dictionary, i: int) -> void:
		if failed != "":
			return
		if r.screen.k == "reward":
			r.screen.items[i].taken = true
		var st = _next("mark")
		if st == null:
			return
		var msg: String = ("  mark index TS=%s GD=%d\n" % [st.i, i]) if st.i != i else ""
		msg += h.check_state(expected, "run", st, MqParity.canon_run(r))
		if msg != "":
			_fail(st, msg)

	func force_lose(s: Dictionary) -> void:
		if failed != "":
			s.over = "lose"
			return
		s.over = "lose"
		var st = _next("lose")
		if st == null:
			return
		var msg: String = h.check_state(expected, "combat", st, MqParity.canon_combat(s))
		if msg != "":
			_fail(st, msg)

func lockstep_case(data: Dictionary) -> String:
	var io = LockIO.new()
	io.h = self
	io.steps = data.steps
	if data.kind == "combat":
		var s = io.create_combat(data.cfg)
		if io.failed == "":
			MqSim.fight_loop(s, io)
		total_steps += io.idx
		total_actions += io.actions
		if io.failed != "":
			return io.failed
		if io.idx != io.steps.size():
			return "GD fight ended after %d steps, TS trace has %d (next TS %s)" % [io.idx, io.steps.size(), where(io.idx, io.steps[io.idx])]
		return ""
	# run
	var first: Dictionary = data.steps[0]
	var r = MqRun.new_run(run_opts(data))
	io.idx = 1
	var e0 = check_state(io.expected, "run", first, MqParity.canon_run(r))
	if e0 != "":
		return where(0, first) + "\n" + e0
	var meta_at = -1
	var err_at = -1
	for i in data.steps.size():
		if data.steps[i].k == "meta":
			meta_at = i
		if data.steps[i].k == "error":
			err_at = i
	var recorded: int = data.steps.size() - (1 if meta_at >= 0 else 0) - (1 if err_at >= 0 else 0)
	var guard = 0
	MqSim.last_error = null
	while guard < 3000:
		guard += 1
		if not MqSim.step(r, io):
			break
		if io.failed != "":
			break
		if data.get("truncated") == true and io.idx >= recorded:
			break
	total_steps += io.idx
	total_actions += io.actions
	if io.failed != "":
		return io.failed
	if MqSim.last_error != null and err_at < 0:
		return "GD policy error (TS had none): %s at step #%d" % [MqSim.last_error, io.idx]
	if err_at >= 0 and MqSim.last_error == null:
		return "TS policy error not reproduced: %s" % data.steps[err_at].message
	if io.idx < recorded:
		return "GD run ended after %d steps, TS trace has %d (next TS %s)" % [io.idx, recorded, where(io.idx, data.steps[io.idx])]
	if meta_at >= 0:
		var m = check_meta(r, data.steps[meta_at])
		if m != "":
			return where(meta_at, data.steps[meta_at]) + "\n" + m
	return ""

# ───────────── replay: recorded TS actions drive, engine parity ─────────────

func bot_choice(s: Dictionary, src: String):
	match src:
		"choose":
			return MqAuto.choose_action(s)
		"answer", "settle":
			return MqAuto.auto_answer(s)
		"pass":
			return {"type": "pass"}
		"aiError", "end":
			return {"type": "endTurn"}
	return null

func replay_case(data: Dictionary) -> String:
	var expected = {}
	var s = null
	var r = null
	var errs = []
	if data.kind == "run":
		r = MqRun.new_run(run_opts(data))
	for i in data.steps.size():
		var st: Dictionary = data.steps[i]
		var msg = ""
		match st.k:
			"newRun":
				msg = check_state(expected, "run", st, MqParity.canon_run(r))
			"start":
				var cfg = st.cfg
				if r != null:
					var own = MqRun.combat_config(r)
					var d = MqParity.diff(st.cfg, MqParity.canon(own), "$cfg")
					if not d.is_empty():
						msg += "  cfg:\n    " + "\n    ".join(d) + "\n"
					cfg = own
				s = MqApi.create_combat(cfg)
				msg += check_state(expected, "combat", st, MqParity.canon_combat(s)) + check_events(st, s.events)
			"act":
				bot_checks += 1
				var bc = bot_choice(s, st.src)
				if not MqParity.diff(st.a, MqParity.canon(bc)).is_empty():
					bot_mismatch += 1
					if bot_mismatch <= 5:
						print("  bot mismatch %s %s: TS=%s GD=%s" % [data.name, where(i, st), MqParity.short(st.a), MqParity.short(MqParity.canon(bc))])
				var res = MqApi.act(s, st.a.duplicate(true))
				total_actions += 1
				if not res.ok:
					msg = "  GD rejected the recorded action: %s\n" % res.error
				msg += check_state(expected, "combat", st, MqParity.canon_combat(s)) + check_events(st, res.events)
			"lose":
				s.over = "lose"
				msg = check_state(expected, "combat", st, MqParity.canon_combat(s))
			"run":
				var err = MqRun.run_act(r, st.a.duplicate(true))
				total_actions += 1
				if err != null:
					msg = "  GD rejected the recorded run action: %s\n" % err
				msg += check_state(expected, "run", st, MqParity.canon_run(r))
			"mark":
				r.screen.items[st.i].taken = true
				msg = check_state(expected, "run", st, MqParity.canon_run(r))
			"meta":
				msg = check_meta(r, st)
			"error":
				pass
		total_steps += 1
		if msg != "":
			errs.append(where(i, st) + "\n" + msg)
			if not keep_going or errs.size() >= 5:
				break
	return "\n".join(errs)
