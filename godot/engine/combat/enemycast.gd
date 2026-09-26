## Port of src/engine/combat/enemycast.ts — boss / elite hand AI (the `bossCast` script). The enemy draws up to
## its hand size, gains energy, then plays cards one at a time (each as its own chain, so the player may respond).
## Choice is greedy by a one-ply evaluation on a cloned state.
class_name MqCast
extends RefCounted

const HAND := 3

static func enemy_cost(d: Dictionary) -> int:
	var g = 0 if typeof(d.cost.g) == TYPE_STRING else d.cost.g
	return g + (d.cost.c.size() if d.cost.get("c") != null else 0)

static func refill(s: Dictionary, boss_id: String) -> void:
	var sd: Dictionary = s.sides.enemy
	while sd.hand.size() < HAND:
		if sd.deck.is_empty():
			var deck: Array = MqU.nz(MqContent.enemy(boss_id).get("deck"), [])
			if deck.is_empty():
				return
			var cards = []
			for id in deck:
				cards.append({"uid": MqCore.new_uid(s), "id": id, "up": false})
			sd.deck = MqRng.shuffle(s.rng, cards)
		sd.hand.append(sd.deck.pop_back())

## returns a uid, null (no target needed) or the string "__none" (TS undefined: no legal target)
static func choose_target(s: Dictionary, card: Dictionary):
	var d = MqCore.card_def(card)
	var tg = MqCore.card_targets(s, "enemy", d)
	if tg == null:
		return null
	if tg.is_empty():
		return "__none"
	var t = d.get("target")
	var hostile: bool = t == "enemy" or t == "enemyUnit" or t == "enemyNoCommander" or d.type == "delay"
	if hostile:
		var pc = MqBoard.commander_of(s, "player")
		if pc != null and tg.has(pc.uid):
			return pc.uid
		return tg[0]
	var own = []
	for id in tg:
		var u = MqBoard.unit(s, id)
		if MqBoard.alive(u):
			own.append(u)
	own = MqU.stable_sort(own, func(a, b): return a.hp - b.hp)
	return own[0].uid if not own.is_empty() else tg[0]

static func boss_cast(s: Dictionary, task: Dictionary, args: Dictionary) -> void:
	var boss = MqBoard.unit(s, task.ctx.source)
	if not MqBoard.alive(boss):
		return
	var d = MqContent.enemy(boss.def)
	var sd: Dictionary = s.sides.enemy
	if not MqU.truthy(args.get("cont")):
		var en = d.get("energy")
		if en == null:
			en = {"start": 2, "perTurn": 1, "max": 6}
		sd.energy = min(en.max, sd.energy + en.perTurn)
		refill(s, boss.def)
	var options = []
	for c in sd.hand:
		if enemy_cost(MqCore.card_def(c)) <= sd.energy:
			options.append(c)
	if options.is_empty():
		return
	# one-ply greedy: value from the enemy's perspective = -player eval
	var best = null
	var best_v = -INF
	for c in options:
		var t = choose_target(s, c)
		if typeof(t) == TYPE_STRING and t == "__none":
			continue
		var trial = MqAuto.clone_state(s)
		trial.events = []
		trial.tasks = []
		trial.triggers = []
		trial.pending = null
		# approximate: apply the card effects directly
		var v = -quick_apply(trial, c, t) + enemy_cost(MqCore.card_def(c)) * 0.5
		if v > best_v:
			best_v = v
			best = c
	if best == null:
		return
	var target = choose_target(s, best)
	if typeof(target) == TYPE_STRING:
		target = null
	sd.hand.remove_at(MqU.idx_same(sd.hand, best))
	sd.energy -= enemy_cost(MqCore.card_def(best))
	MqCore.emit(s, {"t": "play", "side": "enemy", "card": best, "target": target})
	s.limbo.append(best)
	# continue casting after this card resolves
	MqCore.splice_next(task, [{"op": "script", "id": "bossCast", "args": {"cont": true}}])
	s.tasks.append({"k": "chain", "stage": "window", "links": [{"kind": "card", "side": "enemy", "card": best, "target": target, "slot": null, "x": 0}], "passes": 0, "origin": "enemy"})

static func quick_apply(s: Dictionary, card: Dictionary, target) -> float:
	var d = MqCore.card_def(card)
	var effs: Array = MqU.nz(d.get("effects"), []).duplicate()
	if d.type == "unit":
		var ud = d.get("unit")
		var atk = MqU.nz(ud.get("atk"), 0) if ud != null else 0
		var hp = MqU.nz(ud.get("hp"), 0) if ud != null else 0
		return MqAuto.evaluate(s) - 10 - atk * 2 - hp
	MqCore.push_fx(s, effs, MqCore.card_ctx(s, "enemy", card, target))
	# try { run(s) } catch { return evaluate(s) }
	var abort_before = MqCore.abort
	MqCore.run(s)
	MqCore.abort = abort_before
	return MqAuto.evaluate(s)

static func enemy_hand_size(s: Dictionary) -> int:
	return s.sides.enemy.hand.size()
