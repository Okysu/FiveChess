## Port of src/engine/combat/intents.ts — enemy intent scripts: move selection, targeting and live previews.
class_name MqIntents
extends RefCounted

static func enemy_moves(u: Dictionary) -> Dictionary:
	var d = MqContent.enemy(u.def)
	var ph = null
	if MqU.truthy(u.get("phase")) and d.get("phases") != null:
		ph = MqU.at(d.phases, u.phase - 1)
	if ph != null and ph.get("moves") != null:
		var m: Dictionary = d.moves.duplicate(false)
		for k in ph.moves:
			m[k] = ph.moves[k]
		return m
	return d.moves

static func enemy_ai(u: Dictionary) -> Dictionary:
	var d = MqContent.enemy(u.def)
	var ph = null
	if MqU.truthy(u.get("phase")) and d.get("phases") != null:
		ph = MqU.at(d.phases, u.phase - 1)
	if ph != null and ph.get("ai") != null:
		return ph.ai
	return d.ai

static func can_use_move(s: Dictionary, u: Dictionary, mv: Dictionary) -> bool:
	if mv.intent.has("attack") and u.kind == "unit" and MqBoard.reach(s, u) <= 0:
		# back-row melee: attack only if it can advance
		if u.row == "front":
			return true
		for id in s.sides[u.side].front:
			if not MqBoard.alive(MqBoard.unit(s, id)):
				return true
		return false
	if mv.intent.has("summon"):
		var sd: Dictionary = s.sides[u.side]
		for id in sd.front + sd.back:
			if not MqBoard.alive(MqBoard.unit(s, id)):
				return true
		return false
	return true

static func _ok(s: Dictionary, u: Dictionary, moves: Dictionary, m) -> bool:
	return moves.get(m) != null and can_use_move(s, u, moves[m])

static func choose_move(s: Dictionary, u: Dictionary, ai: Dictionary, moves: Dictionary, depth_guard := 0) -> String:
	var st: Dictionary = u.ai
	match ai.type:
		"cycle":
			var seq: Array = ai.sequence
			var n = seq.size()
			if st.cycle == 0 and ai.get("start") == "random":
				st.cycle = MqU.floori(MqRng.rand(s.rng) * n)
			elif st.cycle == 0 and (typeof(ai.get("start")) == TYPE_INT or typeof(ai.get("start")) == TYPE_FLOAT):
				st.cycle = ai.start
			for k in n:
				var m: String = seq[(st.cycle + k) % n]
				if _ok(s, u, moves, m):
					st.cycle = st.cycle + k + 1
					return m
			st.cycle += 1
			return seq[0]
		"weighted":
			var entries = []
			for m in ai.weights:
				if _ok(s, u, moves, m):
					entries.append([m, ai.weights[m]])
			var nr = MqU.nz(ai.get("noRepeat"), 0)
			var filtered = []
			for e in entries:
				if nr <= 0:
					filtered.append(e)
					continue
				var last = MqU.js_slice(st.history, -nr)
				var all_same = last.size() == nr
				if all_same:
					for h in last:
						if h != e[0]:
							all_same = false
							break
				if not all_same:
					filtered.append(e)
			var pool = filtered if not filtered.is_empty() else entries
			if pool.is_empty():
				return ai.weights.keys()[0]
			return MqRng.weighted_pick(s.rng, pool, func(e): return e[1])[0]
		"script":
			var firsts: Array = MqU.nz(ai.get("first"), [])
			var turn_no: int = st.history.size()
			if turn_no < firsts.size() and _ok(s, u, moves, firsts[turn_no]):
				return firsts[turn_no]
			var ctx = {"side": u.side, "source": u.uid, "kind": "unit", "target": null, "vars": {}}
			var rules: Array = MqU.nz(ai.get("rules"), [])
			for i in rules.size():
				var r: Dictionary = rules[i]
				var key = "r%d" % i
				if r.get("once") == true and st.fired.has(key):
					continue
				if not _ok(s, u, moves, r.move):
					continue
				if MqEval.eval_cond(s, r["if"], ctx):
					if r.get("once") == true:
						st.fired.append(key)
					return r.move
			if depth_guard > 5:
				return moves.keys()[0]
			return choose_move(s, u, ai.then, moves, depth_guard + 1)
	return ""

static func roll_intent(s: Dictionary, u: Dictionary) -> void:
	if u.side != "enemy" or u.origin != "enemy" or not MqBoard.alive(u):
		return
	var moves = enemy_moves(u)
	var id = choose_move(s, u, enemy_ai(u), moves)
	var mv = moves.get(id)
	u.ai.history.append(id)
	var target = pick_target(s, u, MqU.nz(mv.get("target"), default_rule(mv))) if mv != null else null
	u.intent = {"move": id, "target": target}
	MqCore.emit(s, {"t": "intent", "uid": u.uid, "move": id, "target": target})

static func default_rule(mv: Dictionary) -> String:
	if mv.intent.has("attack"):
		return "default"
	if mv.intent.has("debuff"):
		return "default"
	return "none"

static func pick_target(s: Dictionary, u: Dictionary, rule: String):
	var foes = []
	for f in MqBoard.units_of(s, "player", true):
		if not f.stealth:
			foes.append(f)
	var cmd = MqBoard.commander_of(s, "player")
	match rule:
		"none":
			return null
		"self":
			return u.uid
		"commander":
			return cmd.uid if cmd != null else null
		"default":
			var legal = MqBoard.attack_targets(s, u, u.kind == "unit" and u.row == "back")
			if not legal.is_empty():
				if cmd != null:
					for l in legal:
						if l.uid == cmd.uid:
							return cmd.uid
				return MqRng.pick(s.rng, legal).uid
			var sorted = MqU.stable_sort(foes, func(a, b): return MqBoard.depth(s, a) - MqBoard.depth(s, b))
			return sorted[0].uid if not sorted.is_empty() else null
		"randomUnit":
			var us = foes.filter(func(f): return f.kind == "unit")
			var p = MqRng.pick(s.rng, us)
			if p == null:
				p = cmd
			return p.uid if p != null else null
		"lowestHp":
			var legal = MqBoard.attack_targets(s, u, true)
			var list = legal if not legal.is_empty() else foes
			var sorted = MqU.stable_sort(list, func(a, b): return MqU.cmp_or(a.hp - b.hp, a.ts - b.ts))
			return sorted[0].uid if not sorted.is_empty() else null
		"highestAtk":
			var us = foes.filter(func(f): return f.kind == "unit")
			if us.is_empty():
				return cmd.uid if cmd != null else null
			return MqU.stable_sort(us, func(a, b): return MqU.cmp_or(MqBoard.atk_of(s, b) - MqBoard.atk_of(s, a), a.ts - b.ts))[0].uid
		"ally":
			var allies = MqBoard.units_of(s, "enemy", true).filter(func(a): return a.uid != u.uid)
			var p = MqRng.pick(s.rng, allies)
			return (p if p != null else u).uid
		"allyLowest":
			var allies = MqBoard.units_of(s, "enemy", true)
			var sorted = MqU.stable_sort(allies, func(a, b): return MqU.fdiv(a.hp, MqBoard.max_hp_of(s, a)) - MqU.fdiv(b.hp, MqBoard.max_hp_of(s, b)))
			return sorted[0].uid if not sorted.is_empty() else u.uid
	return null

## re-validate an intent target at declaration time
static func retarget(s: Dictionary, u: Dictionary, mv: Dictionary):
	var rule: String = MqU.nz(mv.get("target"), default_rule(mv))
	var cur = u.intent.get("target") if u.get("intent") != null else null
	var t = MqBoard.unit(s, cur)
	if rule == "none":
		return null
	if rule == "self":
		return u.uid
	if not MqBoard.alive(t):
		return pick_target(s, u, rule)
	if rule == "default":
		var legal = MqBoard.attack_targets(s, u, u.kind == "unit" and u.row == "back")
		if not legal.is_empty():
			var found = false
			for l in legal:
				if l.uid == t.uid:
					found = true
					break
			if not found:
				return pick_target(s, u, rule)
		if t.stealth:
			return pick_target(s, u, rule)
	return t.uid

# ───────────── previews ─────────────

static func intent_preview(s: Dictionary, u: Dictionary):
	if u.get("intent") == null:
		return null
	var mv = enemy_moves(u).get(u.intent.move)
	if mv == null:
		return null
	var ctx = {"side": u.side, "source": u.uid, "kind": "move", "target": u.intent.target, "vars": {"atk": MqBoard.atk_of(s, u)}}
	var tgt = MqBoard.unit(s, u.intent.target)
	var out = {"types": mv.intent, "name": mv.name, "target": u.intent.target, "statuses": []}
	_walk(s, u, mv.effects, ctx, tgt, out)
	return out

static func _walk(s: Dictionary, u: Dictionary, effs: Array, ctx: Dictionary, tgt, out: Dictionary) -> void:
	for e in effs:
		var op: String = e.op
		if op == "attack":
			var base = MqBoard.atk_of(s, u) if e.get("amount") == null else MqEval.eval_value(s, e.amount, ctx)
			var hits = 1 if e.get("times") == null else MqEval.eval_value(s, e.times, ctx)
			var d = MqCore.calc_damage(s, u, tgt, base, "attack") if tgt != null else base
			out.damage = d if MqU.nz(out.get("damage"), 0) == 0 else out.damage
			out.hits = MqU.nz(out.get("hits"), 0) + hits
		elif op == "damage" and typeof(e.target) == TYPE_STRING and (e.target == "target" or e.target == "commander" or e.target == "enemyCommander" or e.target == "allEnemies"):
			var base = MqEval.eval_value(s, e.amount, ctx)
			var hits = 1 if e.get("times") == null else MqEval.eval_value(s, e.times, ctx)
			var d = MqCore.calc_damage(s, u, tgt, base, "effect", e.get("attack") == true) if tgt != null else base
			out.damage = d if MqU.nz(out.get("damage"), 0) == 0 else out.damage
			out.hits = MqU.nz(out.get("hits"), 0) + hits
		elif op == "armor":
			out.armor = MqU.nz(out.get("armor"), 0) + safe_val(s, e.amount, ctx)
		elif op == "status":
			out.statuses.append({"status": e.status, "amount": safe_val(s, e.amount, ctx)})
		elif op == "summon":
			out.summons = MqU.nz(out.get("summons"), 0) + (1 if e.get("n") == null else safe_val(s, e.n, ctx))
		elif op == "repeat":
			var t = safe_val(s, e.times, ctx)
			var i = 0
			while i < t:
				_walk(s, u, e.effects, ctx, tgt, out)
				i += 1

## evalValue with the TS try/catch -> 0
static func safe_val(s: Dictionary, v, ctx: Dictionary):
	var abort_before = MqCore.abort
	var n_before = MqCore.err_count
	var r = MqEval.eval_value(s, v, ctx)
	if MqCore.err_count != n_before:
		MqCore.abort = abort_before
		return 0
	return r
