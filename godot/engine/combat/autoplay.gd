## Port of src/engine/combat/autoplay.ts — deterministic greedy player AI (balance simulator, smoke tests,
## parity harness). One-ply: evaluates each legal action on a cloned state and picks the best by heuristic.
## Float evaluation is written with the same operation order as the TS expression so the doubles match.
class_name MqAuto
extends RefCounted

static var ai_errors: Array = []

## structuredClone(s). Dictionary.duplicate(true) does not preserve aliasing, which the engine relies on in
## exactly one place: a pending rejudge decision's `pendingCtx.effect` IS the `__rejudgeCheck` effect inserted
## into its fx task (answerDecision mutates effect.card and the task must see it). Re-link it after the copy.
## `cfg` is never mutated, so the clone shares it; `actions` is copied shallowly (append-only records).
static func clone_state(s: Dictionary) -> Dictionary:
	var cfg = s.cfg
	var actions: Array = s.actions
	s.cfg = null
	s.actions = []
	var c: Dictionary = s.duplicate(true)
	s.cfg = cfg
	s.actions = actions
	c.cfg = cfg
	c.actions = actions.duplicate(false)
	var pc = s.pendingCtx
	if pc != null and pc.get("effect") != null:
		var task = MqU.at(s.tasks, pc.task)
		if task != null and task.k == "fx":
			var j = MqU.idx_same(task.effects, pc.effect)
			if j >= 0:
				c.pendingCtx.effect = c.tasks[pc.task].effects[j]
	return c

static func auto_answer(s: Dictionary) -> Dictionary:
	var d = s.pending
	if d == null:
		return {"type": "pass"}
	match d.kind:
		"response":
			# respond with the first option, aimed at a legal target (the declaring enemy, else our commander, else any)
			var uid = MqU.at(d.options, 0)
			if uid != null:
				var card = null
				for c in s.hand:
					if c.uid == uid:
						card = c
						break
				var def = MqCore.card_def(card) if card != null else null
				if def != null:
					var tg = MqCore.card_targets(s, "player", def)
					if tg == null:
						return {"type": "respond", "card": uid}
					var pc = MqBoard.commander_of(s, "player")
					var pcu = pc.uid if pc != null else null
					var pick_t
					var tgt_spec = def.get("target")
					if d.actor != null and tg.has(d.actor) and typeof(tgt_spec) == TYPE_STRING and String(tgt_spec).begins_with("enemy"):
						pick_t = d.actor
					elif pcu != null and tg.has(pcu):
						pick_t = pcu
					else:
						pick_t = MqU.at(tg, 0)
					if pick_t != null:
						return {"type": "respond", "card": uid, "target": pick_t}
			return {"type": "pass"}
		"chooseCards":
			# discard/exhaust the cheapest-value cards; discover the first
			var sorted = MqU.stable_sort(d.cards, func(a, b): return card_score(a.id) - card_score(b.id))
			var picks = []
			for c in MqU.js_slice(sorted, 0, d.min):
				picks.append(c.uid)
			return {"type": "choose", "picks": picks}
		"chooseOption":
			return {"type": "choose", "picks": [0]}
		"stargaze":
			# yang first, then high rank
			var yang_of = func(c): return 1 if (c.suit == "sun" or c.suit == "thunder") else 0
			var sorted = MqU.stable_sort(d.cards, func(a, b): return MqU.cmp_or(yang_of.call(b) - yang_of.call(a), b.rank - a.rank))
			var top = []
			for c in sorted:
				top.append(c.id)
			return {"type": "arrange", "top": top, "bottom": []}
		"rejudge":
			var cur: Dictionary = d.card
			var yang: bool = cur.suit == "sun" or cur.suit == "thunder"
			if yang:
				return {"type": "rejudge", "sign": null}
			for i in d.signs.size():
				if d.signs[i].suit == "sun" or d.signs[i].suit == "thunder":
					return {"type": "rejudge", "sign": i}
			return {"type": "rejudge", "sign": null}
	return {"type": "pass"}

const _RARITY_SCORE := {"basic": 0, "common": 1, "rare": 2, "epic": 3, "legendary": 4, "token": 0, "special": 1}

static func card_score(id: String) -> int:
	var d = MqContent.card(id)
	if d.type == "status" or d.type == "curse":
		return -10
	return _RARITY_SCORE[d.rarity]

## evaluation from the player's perspective
static func evaluate(s: Dictionary) -> float:
	if s.over == "win":
		return 1e6
	if s.over == "lose":
		return -1e6
	var pc = MqBoard.commander_of(s, "player")
	var v = 0.0
	v += (pc.hp if pc != null else 0) * 3 + (pc.armor if pc != null else 0) * 1.2
	for u in MqBoard.units_of(s, "player"):
		v += MqBoard.atk_of(s, u) * 2 + u.hp * 1.2 + (1 if u.row == "front" else 0) + u.growth * 3 + u.ward * 3
	# lasting effects that pay off on later turns
	if pc != null:
		var w = s.sides.player.equip.get("weapon")
		if w != null:
			v += min(3, w.durability) * MqBoard.atk_of(s, pc) * 1.2
		v += s.sides.player.equip.size() * 3
		v += pc.statuses.get("might", 0) * 4 + pc.statuses.get("tenacity", 0) * 3 + pc.statuses.get("regen", 0) * 1.5 + pc.ward * 5 + pc.delays.size() * 3
	if s.sides.player.field != null:
		v += 8
	if s.sides.enemy.field != null:
		v -= 8
	v += s.cardsPlayedThisTurn * 0.5
	var press = 1 + max(0, s.turn - 6) * 0.35
	var enc = MqContent.encounters.get(s.cfg.encounter)
	var hallway: bool = enc != null and enc.tier == "normal"
	for e in MqBoard.units_of(s, "enemy", true):
		var ed = MqContent.enemies.get(e.def)
		var etier = ed.tier if ed != null else ""
		var key: bool = hallway or etier == "elite" or etier == "boss" or e.kind == "commander"
		v -= e.hp * (1.5 if e.kind == "commander" else 1.3) * (press if key else 1) + MqBoard.atk_of(s, e) * 2
		v += e.statuses.get("burn", 0) * 0.8 + e.statuses.get("poison", 0) * 1.5 + e.statuses.get("vulnerable", 0) * 2 + e.statuses.get("weak", 0) * 2
		v += e.statuses.get("stun", 0) * 6 + e.statuses.get("freeze", 0) * 4 + e.delays.size() * 7
		var pv = MqIntents.intent_preview(s, e)
		if pv != null and MqU.truthy(pv.get("damage")):
			var tgt = s.units.get(pv.target if pv.target != null else -1)
			var incoming = pv.damage * MqU.nz(pv.get("hits"), 1)
			if tgt != null and tgt.kind == "commander":
				v -= max(0, incoming - tgt.armor) * 2.2
			else:
				v -= incoming * 0.6
	var nsrc = 0
	for x in s.sources:
		if x.get("temp") != true:
			nsrc += 1
	v += nsrc * 4
	v += s.hand.size() * 0.3
	v += s.fate.signs.size() * 2
	return v

static func legal_actions(s: Dictionary) -> Array:
	var out = []
	if s.phase != "main" or s.pending != null:
		return out
	for card in s.hand:
		var info = MqApi.playable_info(s, card)
		if not info.playable:
			continue
		var d = MqCore.card_def(card)
		if d.type == "unit":
			var ud = d.get("unit")
			var kws = ud.get("keywords") if ud != null else null
			var pref = "back" if (ud != null and ud.get("prefersBack") == true) or (kws != null and kws.has("ranged")) else "front"
			var slot = null
			for x in info.slots:
				if x.row == pref:
					slot = x
					break
			if slot == null:
				slot = info.slots[0]
			out.append({"type": "play", "card": card.uid, "slot": slot})
		elif info.targets != null:
			for t in MqU.js_slice(info.targets, 0, 6):
				out.append({"type": "play", "card": card.uid, "target": t})
		else:
			out.append({"type": "play", "card": card.uid})
	for a in MqApi.attack_options(s):
		for t in a.targets:
			out.append({"type": "attack", "attacker": a.attacker, "target": t})
	# potions: spend them in elite/boss fights or when in danger
	var pc = MqBoard.commander_of(s, "player")
	var enc = MqContent.encounters.get(s.cfg.encounter)
	var tier = enc.tier if enc != null else null
	if pc != null and (tier == "elite" or tier == "boss" or pc.hp < MqBoard.max_hp_of(s, pc) * 0.4):
		for i in s.potions.size():
			var p = s.potions[i]
			if not MqU.truthy(p):
				continue
			var t = MqApi.potion_targets(s, i)
			if t == null:
				out.append({"type": "potion", "slot": i})
			else:
				for x in MqU.js_slice(t, 0, 4):
					out.append({"type": "potion", "slot": i, "target": x})
	for i in s.skills.size():
		var u = MqApi.skill_usable(s, i)
		if not u.ok:
			continue
		if u.targets != null:
			for t in MqU.js_slice(u.targets, 0, 4):
				out.append({"type": "skill", "skill": i, "target": t})
		else:
			out.append({"type": "skill", "skill": i})
	return out

static func settle(s: Dictionary) -> void:
	var i = 0
	while i < 20 and s.pending != null:
		MqApi.act(s, auto_answer(s))
		i += 1

## pick the best next action (or endTurn)
static func choose_action(s: Dictionary) -> Dictionary:
	var base = evaluate(s)
	var best = {"type": "endTurn"}
	var best_v = base
	for a in legal_actions(s):
		var c = clone_state(s)
		var r = MqApi.act(c, a)
		if not r.ok:
			continue
		settle(c)
		var v = evaluate(c)
		if v > best_v + 0.01:
			best_v = v
			best = a
	# sacrifice: once per turn (more with relics/skills), the lowest-value card when no better play exists or early
	if MqApi.can_sacrifice(s):
		var sac = pick_sacrifice(s)
		if sac != null and (best.type == "endTurn" or s.sources.size() < 6):
			return {"type": "sacrifice", "card": sac}
	return best

static func pick_sacrifice(s: Dictionary):
	if not MqApi.can_sacrifice(s) or s.hand.is_empty():
		return null
	var ranked = MqU.stable_sort(s.hand, func(a, b): return sac_value(s, a.uid) - sac_value(s, b.uid))
	var p = MqU.at(ranked, 0)
	if p == null:
		return null
	# enough sources: only burn junk (status / curse), never thin the deck of real cards
	var t: String = MqCore.card_def(p).type
	var junk = t == "status" or t == "curse"
	if s.sources.size() >= 7 and not junk:
		return null
	return p.uid

static var _dmg_cache := {}

## JSON.stringify(effects).includes('"damage"'): a key or string value equal to "damage" anywhere
static func _mentions_damage(v) -> bool:
	match typeof(v):
		TYPE_STRING:
			return v == "damage"
		TYPE_DICTIONARY:
			for k in v:
				if String(k) == "damage" or _mentions_damage(v[k]):
					return true
		TYPE_ARRAY:
			for x in v:
				if _mentions_damage(x):
					return true
	return false

static func sac_value(s: Dictionary, uid) -> float:
	var card = null
	for c in s.hand:
		if c.uid == uid:
			card = c
			break
	var d = MqCore.card_def(card)
	var v = float(card_score(card.id) * 3)
	var kws = d.get("keywords")
	if kws != null and kws.has("offering"):
		v -= 5
	var ck = String(card.id) + ("+" if card.up else "")
	if not _dmg_cache.has(ck):
		_dmg_cache[ck] = _mentions_damage(MqU.nz(d.get("effects"), []))
	if _dmg_cache[ck] or d.type == "unit":
		v += 2
	if not MqApi.playable_info(s, card).playable:
		v -= 1
	return v

## play a whole player turn with the greedy AI
static func play_turn(s: Dictionary, max_actions := 30) -> void:
	var i = 0
	while i < max_actions and s.over == null:
		i += 1
		settle(s)
		if s.over != null or s.phase != "main":
			break
		var a = choose_action(s)
		var r = MqApi.act(s, a)
		if not r.ok:
			if ai_errors.size() < 50:
				ai_errors.append(String(a.type) + ": " + String(r.error))
			MqApi.act(s, {"type": "endTurn"})
			break
		if a.type == "endTurn":
			break
	settle(s)
