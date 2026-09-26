## Port of scripts/sim-policy.ts — the balance simulator's play policy: combat driver (greedy autoplay bot turn
## loop) and run-layer heuristics. Every engine call goes through an `io` object so a caller (the parity harness)
## can observe / compare each successful action. `io` is any Object with these methods:
##   create_combat(cfg) -> state          combat_act(s, a, src) -> {ok, error?, events}
##   play_turn(s, io)                     run_act(r, a) -> error String or null
##   mark_taken(r, i)                     force_lose(s)
## src tags: answer | pass | settle | choose | aiError | end (see sim-policy.ts ActSrc).
class_name MqSim
extends RefCounted

class DefaultIO:
	extends RefCounted
	func create_combat(cfg: Dictionary) -> Dictionary:
		return MqApi.create_combat(cfg)
	func combat_act(s: Dictionary, a: Dictionary, _src: String) -> Dictionary:
		return MqApi.act(s, a)
	func play_turn(s: Dictionary, io) -> void:
		MqSim.play_turn_via(s, io)
	func run_act(r: Dictionary, a: Dictionary):
		return MqRun.run_act(r, a)
	func mark_taken(r: Dictionary, i: int) -> void:
		if r.screen.k == "reward":
			r.screen.items[i].taken = true
	func force_lose(s: Dictionary) -> void:
		s.over = "lose"

## autoplay.playTurn written against io (same calls in the same order as MqAuto.play_turn + settle)
static func play_turn_via(s: Dictionary, io, max_actions := 30) -> void:
	var i = 0
	while i < max_actions and s.over == null:
		i += 1
		_settle(s, io)
		if s.over != null or s.phase != "main":
			break
		var a = MqAuto.choose_action(s)
		var r: Dictionary = io.combat_act(s, a, "choose")
		if not r.ok:
			if MqAuto.ai_errors.size() < 50:
				MqAuto.ai_errors.append(String(a.type) + ": " + String(r.error))
			io.combat_act(s, {"type": "endTurn"}, "aiError")
			break
		if a.type == "endTurn":
			break
	_settle(s, io)

static func _settle(s: Dictionary, io) -> void:
	var i = 0
	while i < 20 and s.pending != null:
		io.combat_act(s, MqAuto.auto_answer(s), "settle")
		i += 1

const _RSCORE := {"basic": 0, "common": 1, "rare": 2, "epic": 3, "legendary": 4, "token": 0, "special": 0}

static func score(id: String) -> float:
	var d = MqContent.card(id)
	return _RSCORE[d.rarity] + (0.3 if d.type == "unit" else 0.0)

## answer pending decisions; an answer the engine rejects falls back to "pass"
static func answer_all(s: Dictionary, io) -> void:
	var i = 0
	while i < 20 and s.pending != null:
		i += 1
		if io.combat_act(s, MqAuto.auto_answer(s), "answer").ok:
			continue
		if not io.combat_act(s, {"type": "pass"}, "pass").ok:
			break

## bot turns until the combat ends or the 60-turn cap; returns the loop guard
static func fight_loop(s: Dictionary, io) -> int:
	var guard = 0
	while s.over == null:
		guard += 1
		if guard > 60:
			break
		answer_all(s, io)
		if s.over != null:
			break
		var turn = s.turn
		io.play_turn(s, io)
		answer_all(s, io)
		if s.phase == "main" and s.over == null and s.turn == turn:
			io.combat_act(s, {"type": "endTurn"}, "end")
	if s.over == null:
		io.force_lose(s)
	return guard

static func fight(r: Dictionary, io) -> bool:
	var s: Dictionary = io.create_combat(MqRun.combat_config(r))
	fight_loop(s, io)
	var pc = MqBoard.commander_of(s, "player")
	var enemies = []
	for uid in s.units:
		var u: Dictionary = s.units[uid]
		if u.side == "enemy" and u.origin == "enemy":
			enemies.append(u.def)
	io.run_act(r, {"t": "combatResult", "result": "win" if s.over == "win" else "lose", "hp": pc.hp if pc != null else 0, "gold": s.goldGained,
		"potions": s.potions, "relics": s.relics, "stats": s.stats, "enemies": enemies})
	return s.over == "win"

## one run-layer decision; false once the run is over. Errors (TS throws) -> {"error": msg} via last_error.
static var last_error = null

static func _A(r: Dictionary, io, a: Dictionary) -> bool:
	var err = io.run_act(r, a)
	if err != null:
		last_error = "%s: %s @%s" % [a.t, err, r.screen.k]
		return false
	return true

static func step(r: Dictionary, io) -> bool:
	var sc: Dictionary = r.screen
	match sc.k:
		"actStart":
			return _A(r, io, {"t": "proceed"})
		"map":
			# drink a healing potion that works on the map when low
			var mp = -1
			for i in r.potions.size():
				var p = r.potions[i]
				if MqU.truthy(p) and MqContent.potions.get(p) != null and MqContent.potions[p].get("outOfCombat") != null:
					mp = i
					break
			if mp >= 0 and r.hp < r.maxHp * 0.5:
				return _A(r, io, {"t": "mapPotion", "slot": mp})
			var opts = MqRun.available_nodes(r)
			if opts.is_empty():
				last_error = "no nodes"
				return false
			var hpk = MqU.fdiv(r.hp, r.maxHp)
			var prefs = {"camp": 10 if hpk < 0.5 else 2, "elite": 6 if hpk > 0.7 else 0, "shop": 7 if r.gold > 150 else 1, "combat": 4, "event": 4, "chest": 8,
				"recruit": 1 if MqU.truthy(r.lieutenant) else 9, "stargaze": 3, "boss": 10}
			var best = MqU.stable_sort(opts, func(a, b): return MqU.cmp_or(prefs.get(b.type, 1) - prefs.get(a.type, 1), a.col - b.col))[0]
			return _A(r, io, {"t": "go", "row": best.row, "col": best.col})
		"combat":
			fight(r, io)
			return true
		"reward":
			var i = -1
			for k in sc.items.size():
				if sc.items[k].get("taken") != true:
					i = k
					break
			if i < 0:
				return _A(r, io, {"t": "proceed"})
			var it: Dictionary = sc.items[i]
			if it.k == "cards":
				var indexed = []
				for k in it.options.size():
					indexed.append({"o": it.options[k], "k": k})
				var best = MqU.at(MqU.stable_sort(indexed, func(a, b): return score(b.o.id) - score(a.o.id)), 0)
				# keep the deck from bloating: commons only while the deck is small
				var take: bool = best != null and (r.deck.size() < 18 or (score(best.o.id) >= 2 and r.deck.size() < 28) or score(best.o.id) >= 3)
				return _A(r, io, {"t": "take", "i": i, "choice": best.k if take else null})
			elif it.k == "potion" and not r.potions.has(null):
				io.mark_taken(r, i)
				return true
			return _A(r, io, {"t": "take", "i": i})
		"bossRelic":
			return _A(r, io, {"t": "bossRelic", "i": 0})
		"shop":
			if sc.shop.get("removed") != true and r.gold >= sc.shop.removePrice:
				return _A(r, io, {"t": "removeService"})
			for ci in sc.shop.cards.size():
				var x: Dictionary = sc.shop.cards[ci]
				if x.get("sold") != true and x.price <= r.gold and score(x.card.id) >= 2:
					return _A(r, io, {"t": "buy", "what": "card", "i": ci})
			for ri in sc.shop.relics.size():
				var x: Dictionary = sc.shop.relics[ri]
				if x.get("sold") != true and x.price <= r.gold:
					return _A(r, io, {"t": "buy", "what": "relic", "i": ri})
			return _A(r, io, {"t": "proceed"})
		"camp":
			if sc.done:
				return _A(r, io, {"t": "proceed"})
			var can_up = not MqRun.pick_candidates(r, "upgrade").is_empty()
			var prefer: Array = ["heal", "upgrade", "remove"] if MqU.fdiv(r.hp, r.maxHp) < 0.55 or not can_up else ["upgrade", "heal", "remove"]
			for opt in prefer:
				if io.run_act(r, {"t": "rest", "opt": opt}) == null:
					return true
			return _A(r, io, {"t": "proceed"})
		"pick":
			var cands = MqRun.pick_candidates(r, sc.kind, sc.get("filter"))
			var order = MqU.stable_sort(cands, func(a, b): return score(a.id) - score(b.id) if sc.kind == "remove" else score(b.id) - score(a.id))
			var uids = []
			for x in MqU.js_slice(order, 0, sc.n):
				uids.append(x.uid)
			return _A(r, io, {"t": "pick", "uids": uids})
		"cardChoice":
			var uids = []
			for o in MqU.js_slice(sc.options, 0, sc.n):
				uids.append(o.uid)
			return _A(r, io, {"t": "pick", "uids": uids})
		"event":
			if sc.get("outcome") != null:
				return _A(r, io, {"t": "proceed"})
			var ev: Dictionary = MqContent.events[sc.id]
			var opts: Array = ev.options
			if MqU.truthy(sc.get("page")):
				for p in ev.pages:
					if p.id == sc.page:
						opts = p.options
						break
			for i in opts.size():
				if io.run_act(r, {"t": "event", "i": i}) == null:
					return true
			last_error = "event %s: no valid option" % sc.id
			return false
		"recruit":
			var ai = null if sc.done else (0 if not sc.options.is_empty() else null)
			if not _A(r, io, {"t": "recruit", "i": ai}):
				return false
			if sc.done:
				return _A(r, io, {"t": "proceed"})
			return true
		"stargaze":
			if sc.done:
				return _A(r, io, {"t": "proceed"})
			if MqU.truthy(sc.get("mode")):
				return _A(r, io, {"t": "fate", "op": sc.mode, "idx": 0, "suit": "sun"})
			return _A(r, io, {"t": "fate", "op": "preview"})
		"chest":
			return _A(r, io, {"t": "proceed"} if sc.opened else {"t": "open"})
		"hiddenChoice":
			return _A(r, io, {"t": "hidden", "go": false})
		"victory", "defeat":
			return false
	return false
