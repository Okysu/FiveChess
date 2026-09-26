## Port of src/engine/combat/api.ts — public combat API: create a combat, apply player actions, query legal moves.
class_name MqApi
extends RefCounted

static func empty_side() -> Dictionary:
	var front = []
	front.resize(MqBoard.FRONT)
	var back = []
	back.resize(MqBoard.BACK)
	return {"commander": null, "front": front, "back": back, "equip": {}, "field": null, "hand": [], "deck": [], "energy": 0, "signs": []}

static func create_combat(cfg: Dictionary) -> Dictionary:
	var cmd_def = MqContent.commander(cfg.commander)
	var relics = []
	for r in cfg.relics:
		relics.append(r.duplicate(false))
	var s = {
		"v": 1, "seed": cfg.seed, "rng": MqRng.seed_rng(cfg.seed), "cfg": cfg, "turn": 0, "active": "player", "phase": "busy", "over": null,
		"nextUid": 1, "nextTs": 10, "units": {}, "sides": {"player": empty_side(), "enemy": empty_side()},
		"draw": [], "hand": [], "discard": [], "exhaust": [], "sacrificed": [], "limbo": [],
		"sources": [], "emberCap": 2 + MqU.nz(cfg.get("emberCapBonus"), 0) - (1 if cfg.ascension >= 7 else 0),
		"sacrificesThisTurn": 0, "cardsPlayedThisTurn": 0, "nextCardCostMod": 0,
		"fate": {"deck": [], "discard": [], "known": 0, "signs": []},
		"skills": [], "relics": relics, "potions": cfg.potions.duplicate(),
		"tasks": [], "triggers": [], "pending": null, "pendingCtx": null, "triggerUse": {},
		"stats": {"judgesThisTurn": {}, "dead": 0, "responses": 0, "damageDealt": 0, "damageTaken": 0, "cardsPlayed": 0, "turns": 0},
		"goldGained": 0, "events": [], "log": [], "actions": [],
	}
	# player commander
	var pc = {
		"uid": MqCore.new_uid(s), "side": "player", "kind": "commander", "def": cmd_def.id, "origin": "commander", "up": false, "name": cmd_def.name,
		"row": "cmd", "slot": 0, "baseAtk": 0, "baseMaxHp": cfg.maxHp, "hp": cfg.hp, "armor": 0, "atkBuff": 0, "hpBuff": 0, "tempAtk": 0, "ward": 0,
		"thorns": 0, "growth": 0, "statuses": {}, "extraKeywords": [], "silenced": false, "stealth": false, "ts": 0, "enteredTurn": 0, "attacks": 0,
		"stunImmune": 0, "delays": [], "counter": 0, "essential": true,
	}
	s.units[pc.uid] = pc
	s.sides.player.commander = pc.uid
	# skills
	for sk in cmd_def.skills:
		s.skills.append({"id": sk.id, "used": false, "usedCombat": false, "awakened": false, "from": "commander"})
	var lt = cfg.get("lieutenant")
	if MqU.truthy(lt):
		var l = MqContent.lieutenants.get(lt)
		if l != null:
			s.skills.append({"id": l.skill.id, "used": false, "usedCombat": false, "awakened": false, "from": "lieutenant"})
	# sources
	var srcs: Array = cmd_def.sources.duplicate()
	if MqU.truthy(lt):
		var l = MqContent.lieutenants.get(lt)
		var ni = srcs.find("N")
		if l != null and ni >= 0:
			srcs[ni] = l.faction
	srcs.append_array(MqU.nz(cfg.get("extraStartSources"), []))
	if cfg.ascension >= 11 and srcs.size() > 1:
		srcs.pop_back()
	for col in srcs:
		s.sources.append({"color": col, "ready": true})
	# deck
	var deck = []
	for d in cfg.deck:
		deck.append({"uid": MqCore.new_uid(s), "id": d.id, "up": d.up})
	MqRng.shuffle(s.rng, deck)
	var innate = []
	var innate_uids = {}
	for d in deck:
		var kws = MqCore.card_def(d).get("keywords")
		if kws != null and kws.has("innate"):
			innate.append(d)
			innate_uids[d.uid] = true
	var rest = []
	for d in deck:
		if not innate_uids.has(d.uid):
			rest.append(d)
	s.draw = rest + innate # top of draw pile = end of array
	# fate
	var fd = []
	for f in cfg.fateDeck:
		var c: Dictionary = f.duplicate(false)
		c.id = MqCore.new_uid(s)
		fd.append(c)
	s.fate.deck = MqRng.shuffle(s.rng, fd)
	# enemies
	var enc = MqContent.encounters.get(cfg.encounter)
	if enc == null:
		MqCore.fail("unknown encounter " + String(cfg.encounter))
		return s
	var counters = {"front": 0, "back": 0}
	for e in enc.enemies:
		var d = MqContent.enemy(e.id)
		var row: String = e.row if e.get("row") != null else d.row
		if row == "commander":
			var hp = MqCore.scale_enemy_hp(s, d.tier, d.hp[0])
			var boss = {
				"uid": MqCore.new_uid(s), "side": "enemy", "kind": "commander", "def": d.id, "origin": "enemy", "up": false, "name": d.name, "row": "cmd", "slot": 0,
				"baseAtk": d.atk, "baseMaxHp": hp, "hp": hp, "armor": 0, "atkBuff": 0, "hpBuff": 0, "tempAtk": 0, "ward": MqU.nz(d.get("ward"), 0), "thorns": MqU.nz(d.get("thorns"), 0),
				"growth": 0, "statuses": {}, "extraKeywords": [], "silenced": false, "stealth": false, "ts": 0, "enteredTurn": 0, "attacks": 0,
				"stunImmune": 0, "delays": [], "counter": 0, "essential": true, "ai": {"history": [], "fired": [], "cycle": 0}, "phase": 0,
			}
			boss.ts = MqCore.new_ts(s)
			if cfg.ascension >= 14:
				boss.ward += 1
			s.units[boss.uid] = boss
			s.sides.enemy.commander = boss.uid
			if d.get("deck") != null:
				var cards = []
				for id in d.deck:
					cards.append({"uid": MqCore.new_uid(s), "id": id, "up": false})
				s.sides.enemy.deck = MqRng.shuffle(s.rng, cards)
				s.sides.enemy.energy = d.energy.start if d.get("energy") != null else 0
			continue
		var r = "back" if row == "back" else "front"
		var slot
		if e.get("slot") != null:
			slot = e.slot
		else:
			slot = counters[r]
			counters[r] += 1
		place_unit_silently(s, r, slot, e.id)
	s.events = []
	s.tasks.append({"k": "phase", "name": "playerTurnStart"})
	s.tasks.append({"k": "phase", "name": "combatStart"})
	MqCore.run(s)
	return s

static func place_unit_silently(s: Dictionary, row: String, slot: int, id: String) -> void:
	var size = MqBoard.FRONT if row == "front" else MqBoard.BACK
	var sl = mini(slot, size - 1)
	if s.sides.enemy[row][sl] != null:
		var free = MqBoard.empty_slots(s, "enemy", row)
		if free.is_empty():
			return
		sl = free[0]
	MqCore.place_unit(s, "enemy", row, sl, {"def": id, "origin": "enemy"})

## -> {ok, error?, events}
static func act(s: Dictionary, a: Dictionary) -> Dictionary:
	s.events = []
	var err = apply(s, a)
	if err != null:
		return {"ok": false, "error": err, "events": []}
	if s.active == "player":
		s.acted = true
	s.actions.append(a)
	MqCore.run(s)
	var events: Array = s.events
	s.events = []
	return {"ok": true, "events": events}

static func apply(s: Dictionary, a: Dictionary):
	if s.over != null:
		return "combat over"
	if s.pending != null:
		return MqCore.answer_decision(s, a)
	if not s.tasks.is_empty():
		return "busy"
	match a.type:
		"play":
			return play_card(s, a.card, a.get("target"), a.get("slot"))
		"sacrifice":
			return sacrifice(s, a.card)
		"attack":
			return declare_attack(s, a.attacker, a.target)
		"skill":
			return use_skill(s, a.skill, a.get("target"))
		"potion":
			return use_potion(s, a.slot, a.get("target"))
		"endTurn":
			s.tasks.append({"k": "phase", "name": "playerTurnEnd"})
			return null
	return "invalid action now"

# ───────────── card play ─────────────

## -> {uid, playable, reason?, targets: [uid]|null, slots?: [{row, slot}], payment?: [int]}
static func playable_info(s: Dictionary, card: Dictionary) -> Dictionary:
	var d = MqCore.card_def(card)
	var info = {"uid": card.uid, "playable": false, "targets": null}
	if d.get("unplayable") == true:
		info.reason = "unplayable"
		return info
	if d.get("windowOnly") == true:
		info.reason = "window"
		return info
	var plan = MqCore.plan_payment(s, MqCore.effective_cost(s, card), card)
	info.payment = plan
	info.targets = MqCore.card_targets(s, "player", d)
	if d.type == "unit":
		var slots = []
		for sl in MqBoard.empty_slots(s, "player", "front"):
			slots.append({"row": "front", "slot": sl})
		for sl in MqBoard.empty_slots(s, "player", "back"):
			slots.append({"row": "back", "slot": sl})
		info.slots = slots
		if slots.is_empty():
			info.reason = "slot"
			return info
	if plan == null:
		info.reason = "cost"
		return info
	if info.targets != null and info.targets.is_empty():
		info.reason = "target"
		return info
	info.playable = true
	return info

static func play_card(s: Dictionary, uid, target, slot):
	var card = null
	for c in s.hand:
		if c.uid == uid:
			card = c
			break
	if card == null:
		return "card not in hand"
	var info = playable_info(s, card)
	if not info.playable:
		return "unplayable: " + String(info.get("reason", ""))
	if info.targets != null and (target == null or not info.targets.has(target)):
		return "bad target"
	if info.targets == null:
		target = null
	var d = MqCore.card_def(card)
	if d.type == "unit":
		if slot == null:
			slot = info.slots[0]
		var ok = false
		for x in info.slots:
			if x.row == slot.row and x.slot == slot.slot:
				ok = true
				break
		if not ok:
			return "bad slot"
	var need = MqCore.effective_cost(s, card)
	var plan: Array = info.payment
	var x = plan.size() - need.c.size() if need.x else 0
	MqCore.pay_sources(s, plan)
	s.nextCardCostMod = 0
	s.hand.remove_at(MqU.idx_same(s.hand, card))
	s.limbo.append(card)
	MqCore.emit(s, {"t": "play", "side": "player", "card": card, "target": target})
	s.tasks.append({"k": "chain", "stage": "window", "links": [{"kind": "card", "side": "player", "card": card, "target": target, "slot": slot, "x": x}], "passes": 0, "origin": "player"})
	return null

static func sacrifices_allowed(s: Dictionary):
	return 1 + MqBoard.sum_mods(s, "sacrifices", "player")

static func can_sacrifice(s: Dictionary) -> bool:
	return s.phase == "main" and s.sacrificesThisTurn < sacrifices_allowed(s)

static func sacrifice(s: Dictionary, uid):
	var card = null
	for c in s.hand:
		if c.uid == uid:
			card = c
			break
	if card == null:
		return "card not in hand"
	if s.sacrificesThisTurn >= sacrifices_allowed(s):
		return "already sacrificed this turn"
	var d = MqCore.card_def(card)
	s.sacrificesThisTurn += 1
	s.hand.remove_at(MqU.idx_same(s.hand, card))
	s.sacrificed.append(card)
	var color: String = "N" if d.type == "status" or d.type == "curse" else d.faction
	var gained = MqCore.add_source(s, color, true)
	MqCore.emit(s, {"t": "sacrifice", "card": card, "color": color, "gained": gained})
	MqCore.fire(s, "cardSacrificed", {"side": "player", "card": card})
	if d.get("onSacrifice") != null:
		MqCore.push_fx(s, d.onSacrifice, MqCore.card_ctx(s, "player", card, null))
	return null

# ───────────── attacks ─────────────

## -> [{attacker, targets: [uid]}]
static func attack_options(s: Dictionary) -> Array:
	if s.phase != "main":
		return []
	var out = []
	for u in MqBoard.units_of(s, "player", true):
		if not MqBoard.can_attack(s, u):
			continue
		var t = []
		for x in MqBoard.attack_targets(s, u):
			t.append(x.uid)
		if not t.is_empty():
			out.append({"attacker": u.uid, "targets": t})
	return out

static func declare_attack(s: Dictionary, attacker, target):
	var a = MqBoard.unit(s, attacker)
	if not MqBoard.alive(a) or a.side != "player":
		return "bad attacker"
	if not MqBoard.can_attack(s, a):
		return "cannot attack"
	var ok = false
	for t in MqBoard.attack_targets(s, a):
		if t.uid == target:
			ok = true
			break
	if not ok:
		return "illegal target"
	s.tasks.append({"k": "chain", "stage": "window", "links": [{"kind": "attack", "attacker": attacker, "target": target}], "passes": 0, "origin": "player"})
	return null

# ───────────── skills / potions ─────────────

const FAKE_CARD := {"id": "x", "name": "x", "faction": "N", "type": "tactic", "rarity": "special", "cost": {"g": 0}, "text": "", "art": {"subject": "none...."}}

static func _fake(target) -> Dictionary:
	var d: Dictionary = FAKE_CARD.duplicate(false)
	d.target = target
	return d

## -> {ok, targets}
static func skill_usable(s: Dictionary, i: int) -> Dictionary:
	var sk = MqU.at(s.skills, i)
	var d = MqSkills.skill_def(s, sk) if sk != null else null
	if sk == null or d == null:
		return {"ok": false, "targets": null}
	if d.type == "passive" or d.type == "awaken":
		return {"ok": false, "targets": null}
	if d.type == "active" and sk.used:
		return {"ok": false, "targets": null}
	if d.type == "limited" and sk.usedCombat:
		return {"ok": false, "targets": null}
	if d.get("cost") != null:
		var g = 0 if typeof(d.cost.g) == TYPE_STRING else d.cost.g
		var plan = MqCore.plan_payment(s, {"g": g, "c": MqU.nz(d.cost.get("c"), []), "x": false})
		if plan == null:
			return {"ok": false, "targets": null}
	var targets = null
	if MqU.truthy(d.get("target")) and d.target != "none":
		targets = MqCore.card_targets(s, "player", _fake(d.target))
	if targets != null and targets.is_empty():
		return {"ok": false, "targets": targets}
	return {"ok": true, "targets": targets}

static func use_skill(s: Dictionary, i, target):
	var u = skill_usable(s, i)
	if not u.ok:
		return "skill unavailable"
	if u.targets != null and (target == null or not u.targets.has(target)):
		return "bad target"
	var sk: Dictionary = s.skills[i]
	var d: Dictionary = MqSkills.skill_def(s, sk)
	if d.get("cost") != null:
		var g = 0 if typeof(d.cost.g) == TYPE_STRING else d.cost.g
		var plan = MqCore.plan_payment(s, {"g": g, "c": MqU.nz(d.cost.get("c"), []), "x": false})
		MqCore.pay_sources(s, plan)
	sk.used = true
	if d.type == "limited":
		sk.usedCombat = true
	MqCore.emit(s, {"t": "skill", "index": i})
	s.tasks.append({"k": "chain", "stage": "window", "links": [{"kind": "skill", "side": "player", "skill": i, "target": target}], "passes": 0, "origin": "player"})
	return null

static func potion_targets(s: Dictionary, slot: int):
	var id = MqU.at(s.potions, slot)
	if not MqU.truthy(id):
		return null
	var d = MqContent.potions.get(id)
	if d == null or d.target == "none":
		return null
	return MqCore.card_targets(s, "player", _fake(d.target))

static func use_potion(s: Dictionary, slot, target):
	var id = MqU.at(s.potions, slot)
	if not MqU.truthy(id):
		return "empty slot"
	var d = MqContent.potions.get(id)
	if d == null:
		return "unknown potion"
	var targets = potion_targets(s, slot)
	if targets != null and (target == null or not targets.has(target)):
		return "bad target"
	s.potions[slot] = null
	MqCore.emit(s, {"t": "potion", "slot": slot, "id": id})
	MqCore.push_fx(s, d.effects, {"side": "player", "source": s.sides.player.commander, "kind": "potion", "target": target, "vars": {}})
	return null

# ───────────── misc queries ─────────────

## true when the player has nothing meaningful left to do (drives the end-turn button state)
static func no_actions_left(s: Dictionary) -> bool:
	if s.phase != "main":
		return false
	for c in s.hand:
		if playable_info(s, c).playable:
			return false
	if not attack_options(s).is_empty():
		return false
	for i in s.skills.size():
		if skill_usable(s, i).ok:
			return false
	return true

static func player_commander(s: Dictionary):
	return MqBoard.commander_of(s, "player")
