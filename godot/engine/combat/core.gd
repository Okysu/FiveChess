## Port of src/engine/combat/core.ts — combat rules engine: task stack, effect interpreter, triggers (FIFO queue),
## state-based checks, damage / healing / statuses, turn flow, response chains (LIFO, <= 4 links), rejudge stages.
## Pure data in, pure data out; all randomness flows through s.rng.
##
## Errors: TS throws (unknown var, loop overflow...). GDScript has no exceptions, so fail() records the error and
## sets `abort`, which stops run(); callers that caught in TS (enemycast quickApply, intents safeVal) reset it.
class_name MqCore
extends RefCounted

static var abort := false
static var err_count := 0
static var last_err := ""

static func fail(msg: String) -> void:
	err_count += 1
	last_err = msg
	abort = true
	push_warning("engine error: " + msg)

# ═════════════ utilities ═════════════

static func emit(s: Dictionary, e: Dictionary) -> void:
	s.events.append(e)

static func new_uid(s: Dictionary) -> int:
	var u: int = s.nextUid
	s.nextUid = u + 1
	return u

static func new_ts(s: Dictionary) -> int:
	var t: int = s.nextTs
	s.nextTs = t + 1
	return t

static func card_def(c: Dictionary) -> Dictionary:
	return MqContent.card(c.id, c.up)

static func base_ctx(s: Dictionary, side: String, kind: String, extra: Dictionary = {}) -> Dictionary:
	var ctx = {"side": side, "source": s.sides[side].commander, "kind": kind, "target": null, "vars": {}}
	for k in extra:
		ctx[k] = extra[k]
	return ctx

static func card_ctx(s: Dictionary, side: String, card: Dictionary, target, x = 0) -> Dictionary:
	var d = card_def(card)
	var vars = {}
	if d.get("vars") != null:
		vars = d.vars.duplicate(false)
	return {"side": side, "source": s.sides[side].commander, "kind": "card", "card": card, "defId": card.id, "up": card.up,
		"target": target, "vars": vars, "x": x}

static func push_fx(s: Dictionary, effects, ctx: Dictionary) -> void:
	if effects == null or effects.is_empty():
		return
	s.tasks.append({"k": "fx", "effects": effects.duplicate(false), "i": 0, "ctx": ctx})

static func splice_next(task: Dictionary, effs: Array) -> void:
	var at: int = task.i
	for k in effs.size():
		task.effects.insert(at + k, effs[k])

# ═════════════ triggers ═════════════

const SELF_DEFAULT := ["damaged", "attacked", "death", "enter", "dealtDamage", "attacking", "healed", "armorGained", "armorBroken", "statusApplied"]
const ANY_DEFAULT := ["judged", "combatStart", "combatEnd", "rejudged"]
const ENEMY_DEFAULT := ["opponentTurnStart", "opponentTurnEnd", "actionDeclared"]

static func default_who(on: String) -> String:
	if SELF_DEFAULT.has(on):
		return "self"
	if ANY_DEFAULT.has(on):
		return "any"
	if ENEMY_DEFAULT.has(on):
		return "enemy"
	return "friendly"

## info keys (all optional): subject, side, source, target, amount, card, suit, status, judge
static func _consider(s: Dictionary, on: String, info: Dictionary, found: Array, trigs, owner_side: String, self_uid, ts, base: Dictionary, label: String) -> void:
	if trigs == null:
		return
	for idx in trigs.size():
		var t: Dictionary = trigs[idx]
		# opponent turn triggers are derived from turn events
		var ev_on: String = t.on
		if t.on == "opponentTurnStart":
			ev_on = "turnStart"
		if t.on == "opponentTurnEnd":
			ev_on = "turnEnd"
		if ev_on != on:
			continue
		var who: String = t.who if t.get("who") != null else default_who(t.on)
		var ev_side = info.get("side")
		var subject = info.get("subject")
		if who == "self" and (subject == null or subject != self_uid):
			continue
		if who == "friendly" and ev_side != owner_side:
			continue
		if who == "enemy" and ev_side != MqState.other(owner_side):
			continue
		var isuit = info.get("suit")
		if MqU.truthy(t.get("suit")) and MqU.truthy(isuit):
			if t.suit == "yang" and not MqDefs.YANG.has(isuit):
				continue
			if t.suit == "yin" and MqDefs.YANG.has(isuit):
				continue
			if t.suit != "yang" and t.suit != "yin" and t.suit != isuit:
				continue
		elif MqU.truthy(t.get("suit")) and not MqU.truthy(isuit):
			continue
		if MqU.truthy(t.get("status")) and t.status != info.get("status"):
			continue
		var key = ("combat:" if t.get("limit") == "combat" else "") + label + "#" + str(idx)
		if MqU.truthy(t.get("limit")) and s.triggerUse.get(key, 0) >= 1:
			continue
		var ctx: Dictionary = base.duplicate(false)
		ctx.vars = base.vars.duplicate(false)
		var ev_target = info.get("target")
		if ev_target == null:
			ev_target = subject
		ctx.event = {"source": info.get("source"), "target": ev_target, "amount": MqU.nz(info.get("amount"), 0),
			"card": info.get("card"), "suit": isuit, "status": info.get("status")}
		ctx.judge = info.get("judge") if info.get("judge") != null else base.get("judge")
		if t.get("if") != null and not MqEval.eval_cond(s, t["if"], ctx):
			continue
		if MqU.truthy(t.get("limit")):
			s.triggerUse[key] = s.triggerUse.get(key, 0) + 1
		found.append({"effects": t.effects, "ctx": ctx, "side": owner_side, "ts": ts, "label": key})

static func fire(s: Dictionary, on: String, info: Dictionary) -> void:
	var found = []
	var pc = MqBoard.commander_of(s, "player")
	var pcu = pc.uid if pc != null else null
	# relics
	for i in s.relics.size():
		var r: Dictionary = s.relics[i]
		if r.get("disabled") == true:
			continue
		_consider(s, on, info, found, MqContent.relic(r.id).get("triggers"), "player", pcu, 1 + i * 0.001,
			base_ctx(s, "player", "relic", {"owner": {"kind": "relic", "ref": r.id}}), "relic:" + String(r.id))
	# commander & lieutenant skills
	for i in s.skills.size():
		var sk: Dictionary = s.skills[i]
		var d = MqSkills.skill_def(s, sk)
		if d == null:
			continue
		_consider(s, on, info, found, d.get("triggers"), "player", pcu, 0.5 + i * 0.001,
			base_ctx(s, "player", "skill", {"owner": {"kind": "skill", "ref": i}}), "skill:%d:%d" % [i, 1 if sk.awakened else 0])
		if not sk.awakened and d.get("awaken") != null and d.awaken.on == on:
			var aw: Dictionary = d.awaken
			var trig = {"on": aw.on, "who": aw.get("who"), "if": aw.get("if"), "effects": [{"op": "script", "id": "__awaken", "args": {"skill": i}}], "limit": "combat"}
			_consider(s, on, info, found, [trig], "player", pcu, 0.5, base_ctx(s, "player", "skill"), "awaken:%d" % i)
	for side in [s.active, MqState.other(s.active)]:
		var sd: Dictionary = s.sides[side]
		var cmd = sd.commander
		for slot in ["weapon", "armor", "mount", "treasure"]:
			var eq = sd.equip.get(slot)
			if eq == null:
				continue
			var d = MqContent.card(eq.card, eq.up)
			var vars = {}
			if d.get("vars") != null:
				vars = d.vars.duplicate(false)
			_consider(s, on, info, found, d.equip.get("triggers") if d.get("equip") != null else null, side, cmd, eq.ts,
				base_ctx(s, side, "equip", {"vars": vars}), "equip:%d" % eq.uid)
		if sd.field != null:
			var d = MqContent.card(sd.field.card, sd.field.up)
			var vars = {}
			if d.get("vars") != null:
				vars = d.vars.duplicate(false)
			_consider(s, on, info, found, d.field.get("triggers") if d.get("field") != null else null, side, cmd, sd.field.ts,
				base_ctx(s, side, "field", {"vars": vars}), "field:%d" % sd.field.uid)
		# units (incl. enemy commanders); dying units only for their own death
		var ids: Array = [cmd] + sd.front + sd.back
		for id in ids:
			var u = MqBoard.unit(s, id)
			if u == null or u.get("removed") == true:
				continue
			if u.get("dead") == true and not (on == "death" and info.get("subject") == u.uid):
				continue
			if u.get("dead") != true and u.hp <= 0 and on != "death":
				continue
			if u.silenced:
				continue
			_consider(s, on, info, found, unit_triggers(u), side, u.uid, u.ts,
				{"side": side, "source": u.uid, "kind": "unit", "target": null, "vars": unit_vars(u), "owner": {"kind": "unit", "ref": u.uid}}, "unit:%d" % u.uid)
	# cards in hand
	for card in s.hand:
		var d = card_def(card)
		if d.get("inHand") != null:
			var base = card_ctx(s, "player", card, null)
			base.card = card
			_consider(s, on, info, found, d.inHand, "player", pcu, 1000 + card.uid, base, "hand:%d" % card.uid)
	var active: String = s.active
	var sorted = MqU.stable_sort(found, func(a, b): return MqU.cmp_or((0 if a.side == active else 1) - (0 if b.side == active else 1), a.ts - b.ts))
	s.triggers.append_array(sorted)

static func unit_triggers(u: Dictionary):
	if u.origin == "enemy":
		return MqContent.enemy(u.def).get("passives")
	if u.origin == "card" or u.origin == "token":
		var ud = MqContent.card(u.def, u.up).get("unit")
		return ud.get("triggers") if ud != null else null
	return null

static func unit_vars(u: Dictionary) -> Dictionary:
	if u.origin == "card" or u.origin == "token":
		var v = MqContent.card(u.def, u.up).get("vars")
		return v.duplicate(false) if v != null else {}
	return {}

# ═════════════ damage / healing / statuses ═════════════

static func is_attack_kind(k: String, attack_flag: bool) -> bool:
	return k == "attack" or k == "retaliate" or (k == "effect" and attack_flag)

## pure damage calculation (for previews and resolution); float math in the same order as the TS doubles
static func calc_damage(s: Dictionary, src, tgt: Dictionary, base, kind: String, attack_flag := false) -> int:
	var amt = float(base)
	if kind == "loss":
		return max(0, MqU.floori(amt))
	var src_side = src.side if src != null else null
	if is_attack_kind(kind, attack_flag) and src != null:
		amt += src.statuses.get("might", 0)
		amt += MqBoard.sum_mods(s, "attackDamage", src.side, src)
		if src.statuses.get("weak", 0) > 0:
			amt *= 0.75
	elif kind == "effect" and src_side != null:
		amt += MqBoard.sum_mods(s, "effectDamage", src_side, src)
	elif kind == "burn":
		amt += MqBoard.sum_mods(s, "burnDamage", tgt.side, tgt)
	elif kind == "poison":
		amt += MqBoard.sum_mods(s, "poisonDamage", tgt.side, tgt)
	# difficulty curve (tuning.ts): enemy attacks and damage effects
	if src != null and src.side == "enemy" and src.origin == "enemy" and (is_attack_kind(kind, attack_flag) or kind == "effect"):
		# 逆命 8: normal enemies' intent values +1 — added before the curve multiplier
		var ed = MqContent.enemies.get(src.def)
		if s.cfg.ascension >= 8 and ed != null and ed.tier == "normal":
			amt += 1
		amt *= MqTuning.combat_tune(s).dmg
	amt += MqBoard.sum_mods(s, "damageTaken", tgt.side, tgt)
	if tgt.statuses.get("vulnerable", 0) > 0:
		amt *= 1.5
	if src != null and MqBoard.has_kw(s, src, "deathtouch") and tgt.kind == "commander" and (kind == "attack" or kind == "effect"):
		amt += 3
	return max(0, MqU.floori(amt))

static func deal_damage(s: Dictionary, src_uid, tgt_uid, base, kind: String, opts: Dictionary = {}) -> int:
	var tgt = MqBoard.unit(s, tgt_uid)
	if not MqBoard.alive(tgt):
		return 0
	var src = MqBoard.unit(s, src_uid)
	var amount = calc_damage(s, src, tgt, base, kind, opts.get("attack") == true)
	var ignores_defense: bool = kind == "poison" or kind == "loss" or opts.get("pierce") == true
	if amount > 0 and tgt.ward > 0 and not ignores_defense:
		tgt.ward -= 1
		emit(s, {"t": "damage", "target": tgt.uid, "source": src_uid, "amount": amount, "hpLoss": 0, "armorLoss": 0, "warded": true, "hp": tgt.hp, "armor": tgt.armor, "kind": kind})
		emit(s, {"t": "ward", "target": tgt.uid, "ward": tgt.ward})
		if src != null and src.stealth:
			src.stealth = false
		return 0
	var rest = amount
	var armor_loss = 0
	if not ignores_defense and tgt.armor > 0:
		armor_loss = mini(tgt.armor, rest)
		tgt.armor -= armor_loss
		rest -= armor_loss
	var hp_loss = mini(rest, maxi(0, tgt.hp))
	tgt.hp -= rest
	if tgt.hp < 0:
		tgt.hp = 0
	emit(s, {"t": "damage", "target": tgt.uid, "source": src_uid, "amount": amount, "hpLoss": hp_loss, "armorLoss": armor_loss, "warded": false, "hp": tgt.hp, "armor": tgt.armor, "kind": kind})
	if tgt.side == "player" and tgt.kind == "commander":
		s.stats.damageTaken += hp_loss
	if tgt.side == "enemy":
		s.stats.damageDealt += hp_loss
	if armor_loss > 0 and tgt.armor == 0:
		fire(s, "armorBroken", {"subject": tgt.uid, "side": tgt.side, "source": src_uid})
	if amount > 0:
		fire(s, "damaged", {"subject": tgt.uid, "side": tgt.side, "source": src_uid, "amount": hp_loss + armor_loss})
		if src != null:
			fire(s, "dealtDamage", {"subject": src.uid, "side": src.side, "source": src.uid, "target": tgt.uid, "amount": hp_loss + armor_loss})
	if src != null and src.stealth:
		src.stealth = false
	if src != null and (hp_loss + armor_loss) > 0 and MqBoard.has_kw(s, src, "lifesteal") and kind != "burn" and kind != "poison":
		var cmd = MqBoard.commander_of(s, src.side)
		if cmd != null:
			heal(s, cmd.uid, hp_loss + armor_loss, src.uid)
	if src != null and hp_loss > 0 and tgt.kind == "unit" and MqBoard.has_kw(s, src, "deathtouch") and (kind == "attack" or kind == "effect" or kind == "retaliate"):
		tgt.hp = 0
	check_phase(s, tgt)
	return hp_loss

static func check_phase(s: Dictionary, u: Dictionary) -> void:
	if u.origin != "enemy" or u.hp <= 0:
		return
	var phases = MqContent.enemy(u.def).get("phases")
	if phases == null:
		return
	var cur = u.get("pendingPhase")
	if cur == null:
		cur = MqU.nz(u.get("phase"), 0)
	var i: int = cur
	while i < phases.size():
		var ph: Dictionary = phases[i]
		if ph.get("minAscension") != null and s.cfg.ascension < ph.minAscension:
			break
		if u.hp <= MqU.floori(MqBoard.max_hp_of(s, u) * ph.hpBelow):
			u.pendingPhase = i + 1
		i += 1

static func heal(s: Dictionary, tgt_uid, base, src_uid = null) -> int:
	var t = MqBoard.unit(s, tgt_uid)
	if not MqBoard.alive(t):
		return 0
	var amt = max(0, base + MqBoard.sum_mods(s, "healing", t.side, t))
	var before: int = t.hp
	t.hp = min(MqBoard.max_hp_of(s, t), t.hp + amt)
	var gained = t.hp - before
	emit(s, {"t": "heal", "target": t.uid, "amount": gained, "hp": t.hp})
	if gained > 0:
		fire(s, "healed", {"subject": t.uid, "side": t.side, "source": src_uid, "amount": gained})
	return gained

static func gain_armor(s: Dictionary, tgt_uid, base, src_uid = null) -> void:
	var t = MqBoard.unit(s, tgt_uid)
	if not MqBoard.alive(t):
		return
	var amt = max(0, base + t.statuses.get("tenacity", 0) + MqBoard.sum_mods(s, "armorGain", t.side, t))
	if amt <= 0:
		return
	t.armor += amt
	emit(s, {"t": "armor", "target": t.uid, "amount": amt, "armor": t.armor})
	fire(s, "armorGained", {"subject": t.uid, "side": t.side, "source": src_uid, "amount": amt})

const DEBUFFS := ["burn", "poison", "freeze", "stun", "vulnerable", "weak", "silence"]
const BUFFS := ["might", "tenacity", "regen"]

static func apply_status(s: Dictionary, tgt_uid, st: String, amount, src_uid = null) -> void:
	var t = MqBoard.unit(s, tgt_uid)
	if not MqBoard.alive(t) or amount == 0:
		return
	if st == "silence":
		silence(s, t)
		return
	if st == "stun":
		if t.stunImmune > 0 or t.statuses.get("stun", 0) > 0:
			return
		amount = 1
	# difficulty curve (tuning.ts) also covers the damage-over-time enemies put on the player's side
	if (st == "burn" or st == "poison") and amount > 0 and t.side == "player":
		var src = MqBoard.unit(s, src_uid)
		if src != null and src.side == "enemy" and src.origin == "enemy":
			amount = maxi(1, MqU.js_round(amount * MqTuning.combat_tune(s).dmg))
	var before = t.statuses.get(st, 0)
	var total = before + amount
	if st != "might" and total < 0:
		total = 0
	if total == 0:
		t.statuses.erase(st)
	else:
		t.statuses[st] = total
	# applied mid-turn to the acting side -> still covers that side's next turn (skip this turn's countdown)
	if amount > 0 and s.active == t.side and s.get("acted") == true and (st == "freeze" or st == "vulnerable" or st == "weak"):
		if t.get("fresh") == null:
			t.fresh = {}
		t.fresh[st] = true
	emit(s, {"t": "status", "target": t.uid, "status": st, "delta": total - before, "total": total})
	if amount > 0:
		fire(s, "statusApplied", {"subject": t.uid, "side": t.side, "source": src_uid, "amount": amount, "status": st})

static func silence(s: Dictionary, u: Dictionary) -> void:
	u.silenced = true
	u.extraKeywords = []
	u.thorns = 0
	u.growth = 0
	u.stealth = false
	emit(s, {"t": "status", "target": u.uid, "status": "silence", "delta": 1, "total": 1})
	emit(s, {"t": "stats", "target": u.uid, "atk": MqBoard.atk_of(s, u), "hp": u.hp, "maxHp": MqBoard.max_hp_of(s, u)})

# ═════════════ attacks ═════════════

static func is_ranged_attacker(s: Dictionary, a: Dictionary) -> bool:
	if a.kind == "commander":
		if a.side == "enemy":
			return true
		var w = s.sides[a.side].equip.get("weapon")
		if w == null:
			return false
		return MqU.nz(MqContent.card(w.card, w.up).equip.get("range"), 1) + w.rangeBonus >= 2
	return MqBoard.has_kw(s, a, "ranged")

static func perform_attack(s: Dictionary, attacker_uid, target_uid, amount_override = null, times = 1, consume := true) -> void:
	var a = MqBoard.unit(s, attacker_uid)
	var t = MqBoard.unit(s, target_uid)
	if not MqBoard.alive(a) or not MqBoard.alive(t):
		return
	emit(s, {"t": "attack", "attacker": a.uid, "target": t.uid})
	fire(s, "attacking", {"subject": a.uid, "side": a.side, "target": t.uid, "source": a.uid})
	fire(s, "attacked", {"subject": t.uid, "side": t.side, "source": a.uid})
	var ranged = is_ranged_attacker(s, a)
	var i = 0
	while i < times:
		if not MqBoard.alive(a) or not MqBoard.alive(t) or a.hp <= 0 or t.hp <= 0:
			break
		var dmg = amount_override if amount_override != null else MqBoard.atk_of(s, a)
		var t_atk = MqBoard.atk_of(s, t)
		deal_damage(s, a.uid, t.uid, dmg, "attack")
		if not ranged and t.kind == "unit" and t_atk > 0:
			deal_damage(s, t.uid, a.uid, t_atk, "retaliate")
		if not ranged and t.thorns > 0 and not t.silenced:
			deal_damage(s, t.uid, a.uid, t.thorns, "thorns")
		i += 1
	if consume:
		a.attacks += 1
	a.stealth = false
	# weapon wear
	if a.kind == "commander":
		var w = s.sides[a.side].equip.get("weapon")
		if w != null and w.durability > 0:
			w.durability -= 1
			if w.durability <= 0:
				destroy_equip(s, a.side, "weapon")
			else:
				emit_weapon(s, a.side)

static func emit_weapon(s: Dictionary, side: String) -> void:
	var w = s.sides[side].equip.get("weapon")
	if w == null:
		return
	var d: Dictionary = MqContent.card(w.card, w.up).equip
	emit(s, {"t": "weapon", "side": side, "atk": MqU.nz(d.get("atk"), 0) + w.atkBonus, "range": MqU.nz(d.get("range"), 1) + w.rangeBonus, "durability": w.durability})

static func destroy_equip(s: Dictionary, side: String, slot: String) -> void:
	var eq = s.sides[side].equip.get(slot)
	if eq == null:
		return
	s.sides[side].equip.erase(slot)
	emit(s, {"t": "equip", "side": side, "slot": slot, "card": null})
	if side == "player":
		s.discard.append({"uid": eq.uid, "id": eq.card, "up": eq.up})

# ═════════════ units on board ═════════════

## init: {def, origin, up?, card?, atk?, hp?}
static func place_unit(s: Dictionary, side: String, row: String, slot: int, init: Dictionary) -> Dictionary:
	var atk = 0
	var hp = 1
	var name: String = init.def
	var thorns = 0
	var growth = 0
	var ward = 0
	if init.origin == "enemy":
		var e = MqContent.enemy(init.def)
		atk = e.atk
		hp = MqRng.rand_int(s.rng, e.hp[0], e.hp[1])
		name = e.name
		thorns = MqU.nz(e.get("thorns"), 0)
		ward = MqU.nz(e.get("ward"), 0)
		hp = scale_enemy_hp(s, e.tier, hp)
	else:
		var d = MqContent.card(init.def, init.get("up") == true)
		var ud = d.get("unit")
		if ud != null:
			atk = MqU.nz(ud.get("atk"), 0)
			hp = MqU.nz(ud.get("hp"), 1)
			thorns = MqU.nz(ud.get("thorns"), 0)
			growth = MqU.nz(ud.get("growth"), 0)
			ward = MqU.nz(ud.get("ward"), 0)
		name = d.name
		if ud != null and ud.get("keywords") != null and ud.keywords.has("ward") and ward == 0:
			ward = 1
	if init.get("atk") != null:
		atk = init.atk
	if init.get("hp") != null:
		hp = init.hp
	var u = {
		"uid": new_uid(s), "side": side, "kind": "unit", "def": init.def, "origin": init.origin, "up": init.get("up") == true,
		"card": init.get("card"), "name": name, "row": row, "slot": slot,
		"baseAtk": atk, "baseMaxHp": hp, "hp": hp, "armor": 0, "atkBuff": 0, "hpBuff": 0, "tempAtk": 0, "ward": ward,
		"thorns": thorns, "growth": growth, "statuses": {}, "extraKeywords": [], "silenced": false, "stealth": false,
		"ts": 0, "enteredTurn": s.turn, "attacks": 0, "stunImmune": 0, "delays": [], "counter": 0,
	}
	u.ts = new_ts(s)
	if init.origin == "enemy":
		u.ai = {"history": [], "fired": [], "cycle": 0}
		u.phase = 0
		if s.cfg.ascension >= 14:
			u.ward += 1
	s.units[u.uid] = u
	s.sides[side][row][slot] = u.uid
	if MqBoard.has_kw(s, u, "stealth"):
		u.stealth = true
	emit(s, {"t": "summon", "unit": MqBoard.snap(s, u), "fromCard": init.origin == "card"})
	fire(s, "enter", {"subject": u.uid, "side": side})
	fire(s, "unitSummoned", {"subject": u.uid, "side": side})
	if side == "enemy":
		MqIntents.roll_intent(s, u)
	return u

static func scale_enemy_hp(s: Dictionary, tier: String, hp) -> int:
	var a = s.cfg.ascension
	var m = MqTuning.combat_tune(s).hp
	if tier == "normal" and a >= 2:
		m += 0.1
	if tier == "boss" and a >= 4:
		m += 0.1
	if tier == "elite" and a >= 3:
		m += 0.1
	return MqU.js_round(hp * m)

static func auto_slot(s: Dictionary, side: String, prefer: String):
	var first = MqBoard.empty_slots(s, side, prefer)
	if not first.is_empty():
		return {"row": prefer, "slot": middle_first(first, MqBoard.FRONT if prefer == "front" else MqBoard.BACK)}
	var alt = "back" if prefer == "front" else "front"
	var second = MqBoard.empty_slots(s, side, alt)
	if not second.is_empty():
		return {"row": alt, "slot": middle_first(second, MqBoard.FRONT if alt == "front" else MqBoard.BACK)}
	return null

static func middle_first(slots: Array, size: int) -> int:
	var mid = MqU.fdiv(size - 1, 2)
	return MqU.stable_sort(slots, func(a, b): return MqU.cmp_or(abs(a - mid) - abs(b - mid), a - b))[0]

static func remove_from_board(s: Dictionary, u: Dictionary) -> void:
	var sd: Dictionary = s.sides[u.side]
	if u.row == "front" and sd.front[u.slot] == u.uid:
		sd.front[u.slot] = null
	if u.row == "back" and sd.back[u.slot] == u.uid:
		sd.back[u.slot] = null
	u.removed = true

# ═════════════ state-based checks ═════════════

static func check_state(s: Dictionary) -> void:
	for guard in 50:
		var dying = []
		for side in [s.active, MqState.other(s.active)]:
			for u in board_order_raw(s, side):
				if u.get("dead") != true and u.get("removed") != true and u.hp <= 0:
					dying.append(u)
		if dying.is_empty():
			break
		var pc = MqBoard.commander_of(s, "player")
		if pc != null and pc.hp <= 0:
			s.over = "lose"
			s.phase = "over"
			emit(s, {"t": "end", "result": "lose"})
			return
		for u in dying:
			u.dead = true
		for u in dying:
			emit(s, {"t": "death", "uid": u.uid})
			if u.side == "enemy":
				s.stats.dead += 1
			fire(s, "death", {"subject": u.uid, "side": u.side})
			fire(s, "unitDied", {"subject": u.uid, "side": u.side})
		for u in dying:
			remove_from_board(s, u)
			# player unit cards return to the discard pile (tokens vanish)
			if u.side == "player" and u.origin == "card" and u.get("card") != null:
				s.discard.append({"uid": u.card.uid, "id": u.card.id, "up": u.card.up})
			# delays on dead units belong to nobody
			u.delays = []
	# boss phase transitions
	for u in MqBoard.board_order(s, "enemy"):
		var pp = u.get("pendingPhase")
		if MqU.truthy(pp) and pp > MqU.nz(u.get("phase"), 0):
			enter_phase(s, u, pp)

static func board_order_raw(s: Dictionary, side: String) -> Array:
	var sd: Dictionary = s.sides[side]
	var out = []
	for id in [sd.commander] + sd.front + sd.back:
		var u = MqBoard.unit(s, id)
		if u != null and u.get("removed") != true:
			out.append(u)
	return out

static func enter_phase(s: Dictionary, u: Dictionary, phase: int) -> void:
	var ph: Dictionary = MqContent.enemy(u.def).phases[phase - 1]
	u.phase = phase
	u.erase("pendingPhase")
	for st in DEBUFFS:
		if MqU.truthy(u.statuses.get(st)):
			u.statuses.erase(st)
			emit(s, {"t": "status", "target": u.uid, "status": st, "delta": 0, "total": 0})
	if ph.get("atk") != null:
		u.baseAtk = ph.atk
	u.ai = {"history": [], "fired": [], "cycle": 0}
	emit(s, {"t": "phaseChange", "uid": u.uid, "phase": phase, "name": ph.name, "text": ph.text})
	if ph.get("effects") != null:
		push_fx(s, ph.effects, {"side": "enemy", "source": u.uid, "kind": "unit", "target": null, "vars": {}})
	MqIntents.roll_intent(s, u)

## true when the combat should end with a win
static func enemy_defeated(s: Dictionary) -> bool:
	var sd: Dictionary = s.sides.enemy
	if sd.commander != null:
		return not MqBoard.alive(MqBoard.unit(s, sd.commander))
	return MqBoard.units_of(s, "enemy").is_empty()

# ═════════════ deck helpers ═════════════

static func hand_limit(s: Dictionary):
	return 10 + MqBoard.sum_mods(s, "handLimit", "player")

static func draw_cards(s: Dictionary, n) -> void:
	var i = 0
	while i < n:
		i += 1
		if s.hand.size() >= hand_limit(s):
			emit(s, {"t": "drawFail", "reason": "handFull"})
			return
		if s.draw.is_empty():
			if s.discard.is_empty():
				emit(s, {"t": "drawFail", "reason": "empty"})
				return
			var all: Array = s.discard.duplicate()
			s.discard.clear()
			s.draw = MqRng.shuffle(s.rng, all)
			emit(s, {"t": "shuffle", "n": s.draw.size()})
			fire(s, "shuffled", {"side": "player"})
		var card = s.draw.pop_back()
		s.hand.append(card)
		emit(s, {"t": "draw", "card": card})
		fire(s, "cardDrawn", {"side": "player", "card": card})

static func _hand_index(s: Dictionary, uid) -> int:
	for i in s.hand.size():
		if s.hand[i].uid == uid:
			return i
	return -1

static func discard_card(s: Dictionary, card: Dictionary) -> void:
	var i = _hand_index(s, card.uid)
	if i < 0:
		return
	s.hand.remove_at(i)
	if card.get("fleeting") == true:
		s.exhaust.append(card)
		emit(s, {"t": "exhaust", "card": card})
		fire(s, "cardExhausted", {"side": "player", "card": card})
		return
	s.discard.append(card)
	emit(s, {"t": "discard", "card": card})
	fire(s, "cardDiscarded", {"side": "player", "card": card})

static func exhaust_card(s: Dictionary, card: Dictionary) -> void:
	var i = _hand_index(s, card.uid)
	if i >= 0:
		s.hand.remove_at(i)
	s.exhaust.append(card)
	emit(s, {"t": "exhaust", "card": card})
	fire(s, "cardExhausted", {"side": "player", "card": card})

static func create_card(s: Dictionary, id: String, to: String, up := false, fleeting := false) -> Dictionary:
	var card = {"uid": new_uid(s), "id": id, "up": up}
	if fleeting:
		card.fleeting = true
	var dest = to
	if dest == "hand" and s.hand.size() >= hand_limit(s):
		dest = "discard"
	if dest == "hand":
		s.hand.append(card)
	elif dest == "draw":
		s.draw.insert(MqRng.rand_int(s.rng, 0, s.draw.size()), card)
	else:
		s.discard.append(card)
	emit(s, {"t": "create", "card": card, "to": dest})
	fire(s, "cardCreated", {"side": "player", "card": card})
	return card

static func own_colors(s: Dictionary) -> Array:
	var out: Array = [MqContent.commander(s.cfg.commander).faction]
	if MqU.truthy(s.cfg.get("lieutenant")):
		var l = MqContent.lieutenants.get(s.cfg.lieutenant)
		if l != null:
			out.append(l.faction)
	return out

# ═════════════ fate ═════════════

static func flip_fate(s: Dictionary) -> Dictionary:
	if s.fate.deck.is_empty():
		var all: Array = s.fate.discard.duplicate()
		s.fate.discard.clear()
		s.fate.deck = MqRng.shuffle(s.rng, all)
		s.fate.known = 0
		emit(s, {"t": "fate", "action": "shuffle", "n": s.fate.deck.size()})
	var card = MqU.pop(s.fate.deck)
	if card == null:
		return {"suit": "moon", "rank": 7, "id": -1}
	if s.fate.known > 0:
		s.fate.known -= 1
	return card

## top of deck = end of array
static func fate_top(s: Dictionary, n) -> Array:
	var top = MqU.js_slice(s.fate.deck, -n)
	top.reverse()
	return top

static func sign_cap(s: Dictionary):
	return 2 + MqBoard.sum_mods(s, "signCap", "player")

# ═════════════ sources / costs ═════════════

## {g, c: [Color], x: bool}
static func effective_cost(s: Dictionary, card: Dictionary) -> Dictionary:
	var d = card_def(card)
	var cc: Array = d.cost.c.duplicate() if d.cost.get("c") != null else []
	var x: bool = typeof(d.cost.g) == TYPE_STRING and d.cost.g == "X"
	if card.get("free") == true:
		return {"g": 0, "c": [], "x": x}
	var g = 0 if x else d.cost.g
	g += MqU.nz(card.get("costMod"), 0)
	g += s.nextCardCostMod
	g += MqBoard.sum_mods(s, "cost", "player", null, card)
	return {"g": max(0, g), "c": cc, "x": x}

## deterministic payment plan: indices into s.sources, or null if unpayable
static func plan_payment(s: Dictionary, need: Dictionary, exclude = null):
	var avail = []
	for i in s.sources.size():
		if s.sources[i].ready:
			avail.append({"src": s.sources[i], "i": i})
	var used = []
	var used_set = {}
	var pref = func(a, b): return (0 if a.src.get("temp") == true else 1) - (0 if b.src.get("temp") == true else 1)
	for col in need.c:
		var cands = []
		for x in avail:
			if not used_set.has(x.i) and x.src.color == col:
				cands.append(x)
		if cands.is_empty():
			return null
		var cand = MqU.stable_sort(cands, pref)[0]
		used.append(cand.i)
		used_set[cand.i] = true
	# demand of each color in the rest of the hand
	var demand = {}
	for h in s.hand:
		if exclude != null and h.uid == exclude.uid:
			continue
		var cost: Dictionary = card_def(h).cost
		if cost.get("c") != null:
			for col in cost.c:
				demand[col] = demand.get(col, 0) + 1
	var rest0 = []
	for x in avail:
		if not used_set.has(x.i):
			rest0.append(x)
	var rest = MqU.stable_sort(rest0, func(a, b):
		var ta = 0 if a.src.get("temp") == true else 1
		var tb = 0 if b.src.get("temp") == true else 1
		if ta != tb:
			return ta - tb
		var na = 0 if a.src.color == "N" else 1
		var nb = 0 if b.src.color == "N" else 1
		if na != nb:
			return na - nb
		return MqU.cmp_or(demand.get(a.src.color, 0) - demand.get(b.src.color, 0), a.i - b.i))
	var g = rest.size() if need.x else need.g
	if rest.size() < g:
		return null
	for k in g:
		if not used_set.has(rest[k].i):
			used.append(rest[k].i)
			used_set[rest[k].i] = true
	return used

static func pay_sources(s: Dictionary, idx: Array) -> void:
	for i in idx:
		var src = MqU.at(s.sources, i)
		if src != null:
			src.ready = false
	s.sources = s.sources.filter(func(src): return not (src.get("temp") == true and not src.ready))
	emit(s, {"t": "sources", "sources": copy_sources(s)})

static func copy_sources(s: Dictionary) -> Array:
	var out = []
	for x in s.sources:
		out.append(x.duplicate(false))
	return out

static func max_sources(s: Dictionary):
	return 10 + MqBoard.sum_mods(s, "maxSources", "player")

static func add_source(s: Dictionary, color: String, ready: bool) -> bool:
	var n = 0
	for x in s.sources:
		if x.get("temp") != true:
			n += 1
	if n >= max_sources(s):
		return false
	s.sources.append({"color": color, "ready": ready})
	emit(s, {"t": "sources", "sources": copy_sources(s)})
	fire(s, "sourceGained", {"side": "player"})
	return true

static func ember_cap(s: Dictionary):
	return max(0, s.emberCap + MqBoard.sum_mods(s, "emberCap", "player"))

# ═════════════ target legality ═════════════

static func card_targets(s: Dictionary, side: String, d: Dictionary):
	var spec: String = MqU.nz(d.get("target"), "none")
	if d.type == "delay":
		var on = d.delay.get("on") if d.get("delay") != null else null
		spec = "friendly" if on == "friendly" else ("any" if on == "any" else "enemy")
	if spec == "none":
		return null
	var foe = MqState.other(side)
	var vis = func(u): return not (u.stealth and u.side != side)
	var ids = func(list: Array) -> Array:
		var out = []
		for u in list:
			out.append(u.uid)
		return out
	match spec:
		"enemy":
			return ids.call(MqBoard.units_of(s, foe, true).filter(vis))
		"enemyUnit", "enemyNoCommander":
			return ids.call(MqBoard.units_of(s, foe).filter(vis))
		"friendlyUnit":
			return ids.call(MqBoard.units_of(s, side))
		"friendly":
			return ids.call(MqBoard.units_of(s, side, true))
		"anyUnit":
			return ids.call(MqBoard.units_of(s, side) + MqBoard.units_of(s, foe).filter(vis))
		"any":
			return ids.call(MqBoard.units_of(s, side, true) + MqBoard.units_of(s, foe, true).filter(vis))
	return null

# ═════════════ effect interpreter ═════════════

static func set_pending(s: Dictionary, task: Dictionary, d: Dictionary, eff, data = null) -> void:
	s.pending = d
	s.pendingCtx = {"task": MqU.idx_same(s.tasks, task), "effect": eff, "data": data}

static func _sel(s: Dictionary, sel, ctx: Dictionary) -> Array:
	return MqEval.select(s, sel, ctx)

static func exec_effect(s: Dictionary, task: Dictionary, eff: Dictionary) -> void:
	var ctx: Dictionary = task.ctx
	var src = ctx.source
	if ctx.side == "enemy" and enemy_resource_op(s, eff, ctx):
		return
	match eff.op:
		"damage":
			var times = 1 if eff.get("times") == null else MqEval.eval_value(s, eff.times, ctx)
			var total = 0
			var k = 0
			while k < times:
				var tgts = _sel(s, eff.target, ctx)
				# an enemy move's attack damage is an attack: "when attacked / when attacking" triggers must see it
				var a = MqBoard.unit(s, src)
				if k == 0 and eff.get("attack") == true and ctx.kind == "move" and MqBoard.alive(a):
					for t in tgts:
						if t.hp <= 0:
							continue
						fire(s, "attacking", {"subject": a.uid, "side": a.side, "target": t.uid, "source": a.uid})
						fire(s, "attacked", {"subject": t.uid, "side": t.side, "source": a.uid})
				for t in tgts:
					if t.hp <= 0:
						continue
					total += deal_damage(s, src, t.uid, MqEval.eval_value(s, eff.amount, ctx), "effect", {"attack": eff.get("attack") == true, "pierce": eff.get("pierce") == true})
				k += 1
			ctx.lastDamage = total
		"attack":
			var a = MqU.at(_sel(s, MqU.nz(eff.get("attacker"), "self"), ctx), 0)
			var t = MqU.at(_sel(s, eff.target, ctx), 0)
			if a != null and t != null:
				var amt = null if eff.get("amount") == null else MqEval.eval_value(s, eff.amount, ctx)
				var times = 1 if eff.get("times") == null else MqEval.eval_value(s, eff.times, ctx)
				perform_attack(s, a.uid, t.uid, amt, times, false)
		"heal":
			for t in _sel(s, eff.target, ctx):
				heal(s, t.uid, MqEval.eval_value(s, eff.amount, ctx), src)
		"loseHp":
			for t in _sel(s, eff.target, ctx):
				deal_damage(s, src, t.uid, MqEval.eval_value(s, eff.amount, ctx), "loss")
		"armor":
			for t in _sel(s, eff.target, ctx):
				gain_armor(s, t.uid, MqEval.eval_value(s, eff.amount, ctx), src)
		"restoreArmor":
			for t in _sel(s, eff.target, ctx):
				var mx = INF if eff.get("max") == null else eff.max
				var n = min(mx, MqU.floori(MqU.nz(t.get("lostArmor"), 0) * eff.fraction))
				t.lostArmor = 0 # several judge branches may match: only the first one restores
				if n > 0:
					gain_armor(s, t.uid, int(n), src)
		"ward":
			for t in _sel(s, eff.target, ctx):
				t.ward += MqEval.eval_value(s, eff.amount, ctx)
				emit(s, {"t": "ward", "target": t.uid, "ward": t.ward})
		"status":
			for t in _sel(s, eff.target, ctx):
				apply_status(s, t.uid, eff.status, MqEval.eval_value(s, eff.amount, ctx), src)
		"cleanse":
			for t in _sel(s, eff.target, ctx):
				var list: Array = DEBUFFS if eff.what == "debuffs" else (BUFFS if eff.what == "buffs" else [eff.what])
				for st in list:
					if MqU.truthy(t.statuses.get(st)):
						t.statuses.erase(st)
						emit(s, {"t": "status", "target": t.uid, "status": st, "delta": 0, "total": 0})
				if eff.what == "debuffs" and t.silenced:
					t.silenced = false
		"buff":
			var atk = 0 if eff.get("atk") == null else MqEval.eval_value(s, eff.atk, ctx)
			var hp = 0 if eff.get("hp") == null else MqEval.eval_value(s, eff.hp, ctx)
			for t in _sel(s, eff.target, ctx):
				if eff.get("until") == "turn":
					t.tempAtk += atk
				else:
					t.atkBuff += atk
				if MqU.truthy(hp):
					t.hpBuff += hp
					t.hp += hp
					if t.hp > MqBoard.max_hp_of(s, t):
						t.hp = MqBoard.max_hp_of(s, t)
				emit(s, {"t": "stats", "target": t.uid, "atk": MqBoard.atk_of(s, t), "hp": t.hp, "maxHp": MqBoard.max_hp_of(s, t)})
		"kill":
			for t in _sel(s, eff.target, ctx):
				if t.kind == "unit":
					t.hp = 0
					emit(s, {"t": "damage", "target": t.uid, "source": src, "amount": 0, "hpLoss": 0, "armorLoss": 0, "warded": false, "hp": 0, "armor": t.armor, "kind": "loss"})
		"silence":
			for t in _sel(s, eff.target, ctx):
				silence(s, t)
		"addKeyword":
			for t in _sel(s, eff.target, ctx):
				var val = 1 if eff.get("value") == null else MqEval.eval_value(s, eff.value, ctx)
				var kw: String = eff.keyword
				if kw == "thorns":
					t.thorns += val
				elif kw == "growth":
					t.growth += val
				elif kw == "ward":
					t.ward += val
					emit(s, {"t": "ward", "target": t.uid, "ward": t.ward})
				elif kw == "stealth":
					t.stealth = true
					if not t.extraKeywords.has("stealth"):
						t.extraKeywords.append("stealth")
				elif not t.extraKeywords.has(kw):
					t.extraKeywords.append(kw)
				emit(s, {"t": "keyword", "target": t.uid, "keyword": kw})
				emit(s, {"t": "stats", "target": t.uid, "atk": MqBoard.atk_of(s, t), "hp": t.hp, "maxHp": MqBoard.max_hp_of(s, t)})
		"summon":
			var side: String = MqState.other(ctx.side) if eff.get("side") == "enemy" else ctx.side
			var n = 1 if eff.get("n") == null else MqEval.eval_value(s, eff.n, ctx)
			var is_enemy_unit: bool = MqContent.enemies.has(eff.unit)
			var k = 0
			while k < n:
				k += 1
				var prefer = "front"
				if eff.get("row") == "back":
					prefer = "back"
				elif eff.get("row") != "front":
					if is_enemy_unit:
						prefer = "back" if MqContent.enemy(eff.unit).row == "back" else "front"
					else:
						var ud = MqContent.card(eff.unit).get("unit")
						prefer = "back" if ud != null and ud.get("prefersBack") == true else "front"
				var slot = auto_slot(s, side, prefer)
				if slot == null:
					break
				var init = {"def": eff.unit, "origin": "enemy" if is_enemy_unit else "token"}
				if eff.get("atk") != null:
					init.atk = MqEval.eval_value(s, eff.atk, ctx)
				if eff.get("hp") != null:
					init.hp = MqEval.eval_value(s, eff.hp, ctx)
				place_unit(s, side, slot.row, slot.slot, init)
		"move":
			for t in _sel(s, eff.target, ctx):
				if t.kind != "unit":
					continue
				var to: String = ("back" if t.row == "front" else "front") if eff.to == "swap" else eff.to
				if t.row == to:
					continue
				var slots = MqBoard.empty_slots(s, t.side, to)
				if slots.is_empty():
					continue
				var sd: Dictionary = s.sides[t.side]
				if t.row == "front" or t.row == "back":
					sd[t.row][t.slot] = null
				var ns = middle_first(slots, MqBoard.FRONT if to == "front" else MqBoard.BACK)
				sd[to][ns] = t.uid
				t.row = to
				t.slot = ns
				emit(s, {"t": "move", "uid": t.uid, "row": to, "slot": ns})
		"bounce":
			for t in _sel(s, eff.target, ctx):
				if t.kind != "unit":
					continue
				remove_from_board(s, t)
				emit(s, {"t": "death", "uid": t.uid})
				if t.side == "player" and t.get("card") != null:
					var card = {"uid": t.card.uid, "id": t.card.id, "up": t.card.up}
					if s.hand.size() < hand_limit(s):
						s.hand.append(card)
						emit(s, {"t": "create", "card": card, "to": "hand"})
					else:
						s.discard.append(card)
		"transform":
			for t in _sel(s, eff.target, ctx):
				if t.kind != "unit":
					continue
				var is_enemy: bool = MqContent.enemies.has(eff.into)
				var row: String = t.row
				var slot: int = t.slot
				var side: String = t.side
				remove_from_board(s, t)
				emit(s, {"t": "death", "uid": t.uid})
				place_unit(s, side, row, slot, {"def": eff.into, "origin": "enemy" if is_enemy else "token"})
		"draw":
			draw_cards(s, MqEval.eval_value(s, eff.n, ctx))
		"discard", "exhaustCards":
			var n = min(MqEval.eval_value(s, eff.n, ctx), s.hand.size())
			var is_ex: bool = eff.op == "exhaustCards"
			if n <= 0 and eff.op == "discard" and eff.mode != "all":
				return
			if eff.mode == "choose":
				if n <= 0:
					return
				set_pending(s, task, {"kind": "chooseCards", "from": "hand", "cards": s.hand.duplicate(), "min": n, "max": n, "purpose": "exhaust" if is_ex else "discard"}, eff)
				return
			var picks: Array = s.hand.duplicate() if eff.op == "discard" and eff.mode == "all" else MqRng.sample(s.rng, s.hand, n)
			finish_hand_pick(s, task, eff, picks)
		"create":
			var n = 1 if eff.get("n") == null else MqEval.eval_value(s, eff.n, ctx)
			var k = 0
			while k < n:
				k += 1
				var id = null
				if typeof(eff.card) == TYPE_STRING:
					id = eff.card
				else:
					var p = MqRng.pick(s.rng, MqContent.filter_cards(eff.card.pool, own_colors(s)))
					id = p.id if p != null else null
				if MqU.truthy(id):
					create_card(s, id, eff.to, eff.get("upgraded") == true, eff.get("fleeting") == true)
		"discover":
			var pool = MqContent.filter_cards(eff.pool, own_colors(s))
			var offer = []
			for d in MqRng.sample(s.rng, pool, MqU.nz(eff.get("n"), 3)):
				var c = {"uid": new_uid(s), "id": d.id, "up": eff.get("upgraded") == true}
				if eff.get("free") == true:
					c.free = true
				offer.append(c)
			if offer.is_empty():
				return
			set_pending(s, task, {"kind": "chooseCards", "from": "offer", "cards": offer, "min": 1, "max": 1, "purpose": "discover", "offer": offer}, eff)
		"fetch":
			var pile: Array = _pile(s, eff.from)
			var f = eff.get("filter")
			var cands = []
			for c in pile:
				if f == null or match_card_inst(c, f):
					cands.append(c)
			var n = min(MqEval.eval_value(s, eff.n, ctx), cands.size())
			if n <= 0:
				return
			if eff.mode == "choose":
				set_pending(s, task, {"kind": "chooseCards", "from": eff.from, "cards": cands.duplicate(), "min": n, "max": n, "purpose": "fetch"}, eff)
				return
			var picks: Array = MqU.js_slice(cands, -n) if eff.mode == "top" else MqRng.sample(s.rng, cands, n)
			for c in picks:
				move_to_hand(s, pile, c)
		"energy":
			var n = MqEval.eval_value(s, eff.n, ctx)
			var k = 0
			while k < n:
				k += 1
				s.sources.append({"color": MqU.nz(eff.get("color"), "N"), "ready": true, "temp": true})
			emit(s, {"t": "sources", "sources": copy_sources(s)})
		"gainSource":
			var n = MqEval.eval_value(s, eff.n, ctx)
			var k = 0
			while k < n:
				k += 1
				add_source(s, own_colors(s)[0] if eff.color == "best" else eff.color, true)
		"emberCap":
			s.emberCap += MqEval.eval_value(s, eff.n, ctx)
		"refresh":
			var n = MqEval.eval_value(s, eff.n, ctx)
			for src2 in s.sources:
				if n <= 0:
					break
				if not src2.ready and src2.get("temp") != true:
					src2.ready = true
					n -= 1
			emit(s, {"t": "sources", "sources": copy_sources(s)})
		"costMod":
			var amt = MqEval.eval_value(s, eff.amount, ctx)
			if eff.scope == "nextCard":
				s.nextCardCostMod += amt
				return
			var own_uid = ctx.card.uid if ctx.get("card") != null else null
			var cands = []
			for c in s.hand:
				if (eff.get("filter") == null or match_card_inst(c, eff.filter)) and c.uid != own_uid:
					cands.append(c)
			var targets: Array = cands if eff.scope == "hand" else MqRng.sample(s.rng, cands, 1)
			for c in targets:
				c.costMod = MqU.nz(c.get("costMod"), 0) + amt
				c.costModUntil = eff.until
		"judge":
			var tgt = MqU.at(_sel(s, eff.target, ctx), 0) if eff.get("target") != null else null
			var party: String = tgt.side if tgt != null else ctx.side
			var card = flip_fate(s)
			var tuid = tgt.uid if tgt != null else null
			emit(s, {"t": "judgeFlip", "card": card, "party": party, "target": tuid})
			splice_next(task, [{"op": "__rejudgeCheck", "stage": 0, "branches": eff.branches, "party": party, "card": card, "target": tuid}])
		"peek":
			s.fate.known = min(s.fate.deck.size(), max(s.fate.known, MqEval.eval_value(s, eff.n, ctx)))
			emit(s, {"t": "fate", "action": "peek", "n": s.fate.known})
		"stargaze":
			var n = min(MqEval.eval_value(s, eff.n, ctx), s.fate.deck.size() + s.fate.discard.size())
			if s.fate.deck.size() < n:
				var all: Array = s.fate.discard.duplicate()
				s.fate.discard.clear()
				s.fate.deck = MqRng.shuffle(s.rng, all) + s.fate.deck
			if ctx.side == "enemy":
				enemy_stargaze(s, n)
				return
			var cards = fate_top(s, n)
			if cards.is_empty():
				return
			set_pending(s, task, {"kind": "stargaze", "cards": cards}, eff)
		"sign":
			var n = MqEval.eval_value(s, eff.n, ctx)
			var signs: Array = s.fate.signs if ctx.side == "player" else s.sides.enemy.signs
			var k = 0
			while k < n:
				k += 1
				var card = flip_fate(s)
				if signs.size() >= sign_cap(s):
					s.fate.discard.append(card)
				else:
					signs.append(card)
			emit(s, {"t": "fate", "action": "sign", "n": signs.size()})
		"fateAdd":
			var n = MqU.nz(eff.get("n"), 1)
			var k = 0
			while k < n:
				k += 1
				var card = {"suit": eff.suit, "rank": eff.rank, "id": new_uid(s)}
				if eff.where == "top":
					s.fate.deck.append(card)
				else:
					s.fate.deck.insert(MqRng.rand_int(s.rng, 0, s.fate.deck.size()), card)
			if eff.where != "top":
				s.fate.known = 0
			emit(s, {"t": "fate", "action": "add", "n": n})
		"delay":
			var d = MqContent.card(eff.card)
			var turns
			if eff.get("turns") == null:
				turns = MqU.nz(d.delay.get("turns"), 1) if d.get("delay") != null else 1
			else:
				turns = MqEval.eval_value(s, eff.turns, ctx)
			for t in _sel(s, eff.target, ctx):
				attach_delay(s, t, eff.card, false, turns, ctx.side)
		"equip":
			equip_card(s, ctx.side, {"uid": new_uid(s), "id": eff.card, "up": eff.get("upgraded") == true})
		"weapon":
			var w = s.sides[ctx.side].equip.get("weapon")
			if w == null:
				return
			if eff.get("atk") != null:
				w.atkBonus += MqEval.eval_value(s, eff.atk, ctx)
			if eff.get("range") != null:
				w.rangeBonus += MqEval.eval_value(s, eff.range, ctx)
			if eff.get("durability") != null:
				w.durability += MqEval.eval_value(s, eff.durability, ctx)
			emit_weapon(s, ctx.side)
		"destroyEquip":
			var side: String = ctx.side if eff.side == "friendly" else MqState.other(ctx.side)
			var slots = []
			for k in ["weapon", "armor", "mount", "treasure"]:
				if s.sides[side].equip.get(k) != null:
					slots.append(k)
			var slot = MqRng.pick(s.rng, slots) if eff.slot == "random" else eff.slot
			if MqU.truthy(slot):
				destroy_equip(s, side, slot)
		"field":
			set_field(s, ctx.side, {"uid": new_uid(s), "id": eff.card, "up": false})
		"cancel":
			var link = declared_link(s, ctx)
			if link != null:
				link.cancelled = true
				emit(s, {"t": "cancel", "what": link.kind})
		"redirect":
			var link = declared_link(s, ctx)
			var to = MqU.at(_sel(s, eff.to, ctx), 0)
			if link != null and to != null and (link.kind == "move" or link.kind == "attack" or link.kind == "card"):
				link.target = to.uid
				emit(s, {"t": "redirect", "to": to.uid})
		"repeat":
			var times = MqEval.eval_value(s, eff.times, ctx)
			var out = []
			var k = 0
			while k < times:
				k += 1
				out.append_array(eff.effects)
			splice_next(task, out)
		"if":
			if MqEval.eval_cond(s, eff.cond, ctx):
				splice_next(task, eff.then)
			else:
				splice_next(task, MqU.nz(eff.get("else"), []))
		"choose":
			if ctx.side == "enemy":
				splice_next(task, eff.options[0].effects)
				return
			var texts = []
			for o in eff.options:
				texts.append(o.text)
			set_pending(s, task, {"kind": "chooseOption", "options": texts}, eff)
		"forEach":
			var list = _sel(s, eff.sel, ctx)
			var out = []
			for u in list:
				out.append({"op": "__it", "uid": u.uid})
				out.append_array(eff.effects)
			out.append({"op": "__it", "uid": null})
			splice_next(task, out)
		"store":
			ctx.vars[eff.key] = MqEval.eval_value(s, eff.value, ctx)
		"counter":
			var amt = MqEval.eval_value(s, eff.amount, ctx)
			var ow = ctx.get("owner")
			if ow != null and ow.kind == "relic":
				var r = null
				for x in s.relics:
					if x.id == ow.ref:
						r = x
						break
				if r != null:
					r.counter += amt
					if MqU.truthy(eff.get("max")) and r.counter >= eff.max:
						r.counter -= eff.max
						splice_next(task, MqU.nz(eff.get("then"), []))
					emit(s, {"t": "relic", "id": r.id})
			elif ow != null and ow.kind == "unit":
				var u = MqBoard.unit(s, ow.ref)
				if u != null:
					u.counter += amt
					if MqU.truthy(eff.get("max")) and u.counter >= eff.max:
						u.counter -= eff.max
						splice_next(task, MqU.nz(eff.get("then"), []))
		"gold":
			s.goldGained += MqEval.eval_value(s, eff.n, ctx)
		"script":
			run_script(s, task, eff.id, MqU.nz(eff.get("args"), {}))
		# ── internal ──
		"__it":
			ctx.it = eff.uid
		"__evCard":
			var ev = {"source": null, "target": null, "amount": 0}
			if ctx.get("event") != null:
				for k in ctx.event:
					ev[k] = ctx.event[k]
			ev.card = eff.card
			ctx.event = ev
		"__judgeSet":
			ctx.judge = eff.card
		"__judgeEnd":
			var card: Dictionary = eff.card
			s.fate.discard.append(card)
			s.stats.judgesThisTurn[card.suit] = s.stats.judgesThisTurn.get(card.suit, 0) + 1
			emit(s, {"t": "judgeResult", "card": card, "branch": eff.branch})
			fire(s, "judged", {"side": ctx.side, "suit": card.suit, "judge": card, "subject": ctx.get("target")})
		"__rejudgeCheck":
			rejudge_step(s, task, eff)
		"__summonCard":
			var card: Dictionary = ctx.card
			var d = card_def(card)
			var slot = eff.get("slot")
			if slot == null:
				var ud = d.get("unit")
				slot = auto_slot(s, ctx.side, "back" if ud != null and ud.get("prefersBack") == true else "front")
			if slot == null:
				ctx.source = null
				return
			var u = place_unit(s, ctx.side, slot.row, slot.slot, {"def": card.id, "origin": "card", "up": card.up, "card": card})
			ctx.source = u.uid
		"__equipCard":
			equip_card(s, ctx.side, ctx.card)
		"__attachDelay":
			var t = MqBoard.unit(s, ctx.get("target"))
			var d = card_def(ctx.card)
			if t != null:
				attach_delay(s, t, ctx.card.id, ctx.card.up, MqU.nz(d.delay.get("turns"), 1) if d.get("delay") != null else 1, ctx.side)
		"__setField":
			set_field(s, ctx.side, ctx.card)
		"__finishCard":
			finish_card(s, ctx, eff.exhaust)
		"__attack":
			var a = MqBoard.unit(s, eff.attacker)
			var t = MqBoard.unit(s, eff.target)
			if MqBoard.alive(a) and MqBoard.alive(t):
				perform_attack(s, a.uid, t.uid)
		"__move":
			return

static func _pile(s: Dictionary, from: String) -> Array:
	if from == "draw":
		return s.draw
	if from == "discard":
		return s.discard
	return s.exhaust

## Ops that act on the player's deck / hand / sources / fate knowledge, run for the enemy side: `draw` draws from
## the enemy commander's deck, `energy` / `gainSource` feed the enemy's energy, the rest do nothing.
static func enemy_resource_op(s: Dictionary, eff: Dictionary, ctx: Dictionary) -> bool:
	var sd: Dictionary = s.sides.enemy
	match eff.op:
		"draw":
			var n = MqEval.eval_value(s, eff.n, ctx)
			var k = 0
			while k < n and sd.hand.size() < 10:
				if sd.deck.is_empty():
					var boss = MqBoard.unit(s, sd.commander)
					var ids: Array = []
					if boss != null and boss.origin == "enemy":
						ids = MqU.nz(MqContent.enemy(boss.def).get("deck"), [])
					if ids.is_empty():
						break
					var cards = []
					for id in ids:
						cards.append({"uid": new_uid(s), "id": id, "up": false})
					sd.deck = MqRng.shuffle(s.rng, cards)
				sd.hand.append(sd.deck.pop_back())
				k += 1
			return true
		"energy", "gainSource":
			sd.energy += MqEval.eval_value(s, eff.n, ctx)
			return true
		"discard", "exhaustCards", "fetch", "discover", "refresh", "costMod", "emberCap", "gold", "peek":
			return true
	return false

static func match_card_inst(c: Dictionary, f: Dictionary) -> bool:
	return MqContent.match_card(card_def(c), f)

static func move_to_hand(s: Dictionary, pile: Array, c: Dictionary) -> void:
	var i = -1
	for k in pile.size():
		if pile[k].uid == c.uid:
			i = k
			break
	if i < 0:
		return
	pile.remove_at(i)
	if s.hand.size() >= hand_limit(s):
		s.discard.append(c)
		return
	s.hand.append(c)
	emit(s, {"t": "create", "card": c, "to": "hand"})

static func finish_hand_pick(s: Dictionary, task: Dictionary, eff: Dictionary, picks: Array) -> void:
	var follow = []
	for c in picks:
		if eff.op == "discard":
			discard_card(s, c)
		else:
			exhaust_card(s, c)
		if eff.get("each") != null:
			follow.append({"op": "__evCard", "card": c})
			follow.append_array(eff.each)
	task.ctx.selected = picks.size()
	splice_next(task, follow)

static func declared_link(s: Dictionary, ctx: Dictionary):
	var dec = ctx.get("declared")
	if dec == null:
		return null
	var i: int = s.tasks.size() - 1
	while i >= 0:
		var t: Dictionary = s.tasks[i]
		if t.k == "chain":
			var l = MqU.at(t.links, dec.link)
			return l if l != null else t.get("resolvedBase")
		i -= 1
	return null

static func attach_delay(s: Dictionary, t: Dictionary, card: String, up: bool, turns, owner: String) -> void:
	if t.delays.size() >= 3:
		return
	t.delays.append({"uid": new_uid(s), "card": card, "up": up, "turns": turns, "owner": owner})
	emit(s, {"t": "delay", "target": t.uid, "card": card, "turns": turns})

static func equip_card(s: Dictionary, side: String, card: Dictionary) -> void:
	var d = card_def(card)
	var slot = d.equip.get("slot") if d.get("equip") != null else null
	if not MqU.truthy(slot):
		return
	if s.sides[side].equip.get(slot) != null:
		destroy_equip(s, side, slot)
	s.sides[side].equip[slot] = {"uid": card.uid, "card": card.id, "up": card.up, "durability": MqU.nz(d.equip.get("durability"), 0), "atkBonus": 0, "rangeBonus": 0, "ts": new_ts(s)}
	emit(s, {"t": "equip", "side": side, "slot": slot, "card": card.id})
	if slot == "weapon":
		emit_weapon(s, side)
	fire(s, "equipped", {"side": side, "card": card})

static func set_field(s: Dictionary, side: String, card: Dictionary) -> void:
	var sd: Dictionary = s.sides[side]
	if sd.field != null and side == "player":
		s.discard.append({"uid": sd.field.uid, "id": sd.field.card, "up": sd.field.up})
	var d = card_def(card)
	var dur = d.field.get("duration") if d.get("field") != null else null
	sd.field = {"uid": card.uid, "card": card.id, "up": card.up, "turns": dur, "ts": new_ts(s)}
	emit(s, {"t": "field", "side": side, "card": card.id})

static func finish_card(s: Dictionary, ctx: Dictionary, force_exhaust: bool) -> void:
	var card: Dictionary = ctx.card
	var d = card_def(card)
	var li = -1
	for k in s.limbo.size():
		if s.limbo[k].uid == card.uid:
			li = k
			break
	if li >= 0:
		s.limbo.remove_at(li)
	var to = "discard"
	if d.type == "unit" or d.type == "equip" or d.type == "field":
		to = "board"
	if d.type == "delay":
		to = "board"
	var kws = d.get("keywords")
	if force_exhaust or (kws != null and kws.has("exhaust")) or card.get("fleeting") == true:
		to = "exhaust"
	if d.type == "unit" and ctx.source == null:
		to = "discard"
	if ctx.side == "player":
		if to == "discard":
			s.discard.append(strip_temp(card))
		elif to == "exhaust":
			s.exhaust.append(card)
			fire(s, "cardExhausted", {"side": "player", "card": card})
		s.cardsPlayedThisTurn += 1
		s.stats.cardsPlayed += 1
	emit(s, {"t": "cardDone", "card": card, "to": to})
	fire(s, "cardPlayed", {"side": ctx.side, "card": card, "target": ctx.get("target")})

static func strip_temp(c: Dictionary) -> Dictionary:
	var out = {"uid": c.uid, "id": c.id, "up": c.up}
	if c.get("costModUntil") == "combat":
		out.costMod = c.get("costMod")
		out.costModUntil = "combat"
	return out

# ── rejudge windows ──

static func rejudge_step(s: Dictionary, task: Dictionary, eff: Dictionary) -> void:
	# stage 0: opponent of the judged party; stage 1: the party itself; stage 2: finalize
	if eff.stage >= 2:
		var card: Dictionary = eff.card
		var b: Dictionary = eff.branches
		var branch = branch_name(card)
		var out: Array = [{"op": "__judgeSet", "card": card}]
		var yang: bool = MqDefs.YANG.has(card.suit)
		var rank_bonus = MqBoard.sum_mods(s, "judgeRank", "player")
		var rank = min(13, card.rank + (rank_bonus if eff.party == "player" else 0))
		if card.get("omen") == true:
			# 凶兆: counts as the worst branch for the player
			var bad
			if eff.party == "player":
				bad = b.get("yin") if b.get("yin") != null else MqU.nz(b.get("low"), [])
			else:
				bad = b.get("yang") if b.get("yang") != null else MqU.nz(b.get("high"), [])
			out.append_array(bad)
		else:
			var suit_b = b.get(card.suit)
			if suit_b != null:
				out.append_array(suit_b)
			if yang and b.get("yang") != null:
				out.append_array(b.yang)
			if not yang and b.get("yin") != null:
				out.append_array(b.yin)
			if rank >= 8 and b.get("high") != null:
				out.append_array(b.high)
			if rank <= 7 and b.get("low") != null:
				out.append_array(b.low)
			for r in MqU.nz(b.get("ranks"), []):
				if rank >= r.min and rank <= r.max:
					out.append_array(r.effects)
		if b.get("always") != null:
			out.append_array(b.always)
		out.append({"op": "__judgeEnd", "card": card, "branch": branch})
		task.ctx.judge = card
		splice_next(task, out)
		return
	var chooser: String = MqState.other(eff.party) if eff.stage == 0 else eff.party
	var nxt: Dictionary = eff.duplicate(false)
	nxt.stage = eff.stage + 1
	var tut = s.cfg.get("tutorial")
	if chooser == "player" and s.fate.signs.size() > 0 and not (tut != null and tut.get("noJudge") == true):
		task.effects.insert(task.i, nxt)
		set_pending(s, task, {"kind": "rejudge", "card": eff.card, "signs": s.fate.signs.duplicate()}, nxt)
		return
	if chooser == "enemy" and s.sides.enemy.signs.size() > 0:
		var swap = enemy_rejudge(s, eff)
		if swap != null:
			var now = MqU.js_splice(s.sides.enemy.signs, swap, 1)[0]
			s.fate.discard.append(eff.card)
			emit(s, {"t": "rejudge", "old": eff.card, "now": now, "side": "enemy"})
			fire(s, "rejudged", {"side": "enemy", "suit": now.suit})
			nxt.card = now
	task.effects.insert(task.i, nxt)

static func branch_name(c: Dictionary) -> String:
	return "omen" if c.get("omen") == true else c.suit

## simple heuristic: enemy prefers yang when it is the party, else yin
static func enemy_rejudge(s: Dictionary, eff: Dictionary):
	var signs: Array = s.sides.enemy.signs
	var want: Array = MqDefs.YANG if eff.party == "enemy" else ["moon", "mountain"]
	if want.has(eff.card.suit):
		return null
	for i in signs.size():
		if want.has(signs[i].suit):
			return i
	return null

static func enemy_stargaze(s: Dictionary, n) -> void:
	# enemy places yin cards (bad for player judgements) on top
	var top = MqU.js_splice(s.fate.deck, -n)
	top = MqU.stable_sort(top, func(a, b): return (0 if MqDefs.YANG.has(a.suit) else 1) - (0 if MqDefs.YANG.has(b.suit) else 1))
	s.fate.deck.append_array(top)
	s.fate.known = 0
	emit(s, {"t": "fate", "action": "arrange", "n": n})

# ── scripts (extension points for complex cards) ──

static func run_script(s: Dictionary, task: Dictionary, id: String, args: Dictionary) -> void:
	if id == "__awaken":
		var i: int = args.skill
		var sk = MqU.at(s.skills, i)
		if sk == null or sk.awakened:
			return
		var d = MqSkills.skill_def(s, sk)
		sk.awakened = true
		emit(s, {"t": "skill", "index": i})
		emit(s, {"t": "log", "text": "觉醒：" + (String(d.name) if d != null else "")})
		if d != null and d.get("awaken") != null and d.awaken.get("effects") != null:
			splice_next(task, d.awaken.effects)
		return
	if id == "bossCast":
		MqCast.boss_cast(s, task, args)
		return
	fail("unknown script " + id)

# ═════════════ decisions ═════════════

static func answer_decision(s: Dictionary, a: Dictionary):
	var d = s.pending
	var pc = s.pendingCtx
	if d == null or pc == null:
		return "no pending decision"
	var task = MqU.at(s.tasks, pc.task)
	if d.kind == "response":
		return answer_response(s, a)
	if task == null or task.k != "fx":
		return "bad pending task"
	var eff = pc.effect
	match d.kind:
		"chooseCards":
			if a.type != "choose":
				return "expected choose"
			var picks = []
			for uid in a.picks:
				for c in d.cards:
					if c.uid == uid:
						picks.append(c)
						break
			var uniq = {}
			for p in a.picks:
				uniq[p] = true
			if uniq.size() != a.picks.size() or picks.size() < d.min or picks.size() > d.max:
				return "bad selection"
			s.pending = null
			s.pendingCtx = null
			if d.purpose == "discover":
				var c: Dictionary = picks[0]
				if s.hand.size() < hand_limit(s):
					s.hand.append(c)
					emit(s, {"t": "create", "card": c, "to": "hand"})
				else:
					s.discard.append(c)
			elif d.purpose == "fetch":
				var pile = _pile(s, eff.from)
				for c in picks:
					move_to_hand(s, pile, c)
			else:
				finish_hand_pick(s, task, eff, picks)
			return null
		"chooseOption":
			if a.type != "choose":
				return "expected choose"
			var opt = MqU.at(eff.options, MqU.at(a.picks, 0) if MqU.at(a.picks, 0) != null else -1)
			if opt == null:
				return "bad option"
			s.pending = null
			s.pendingCtx = null
			splice_next(task, opt.effects)
			return null
		"stargaze":
			if a.type != "arrange":
				return "expected arrange"
			var ids = []
			for x in a.top + a.bottom:
				ids.append(MqU.js_string(x))
			MqU.default_sort(ids)
			var have = []
			for c in d.cards:
				have.append(MqU.js_string(c.id))
			MqU.default_sort(have)
			if ",".join(ids) != ",".join(have):
				return "bad arrangement"
			s.pending = null
			s.pendingCtx = null
			MqU.js_splice(s.fate.deck, -d.cards.size())
			var by_id = {}
			for c in d.cards:
				by_id[c.id] = c
			var bottom = []
			for id in a.bottom:
				bottom.append(by_id.get(id))
			var top = []
			for id in a.top:
				top.append(by_id.get(id))
			bottom.reverse()
			for k in bottom.size():
				s.fate.deck.insert(k, bottom[k])
			var rtop = top.duplicate()
			rtop.reverse()
			s.fate.deck.append_array(rtop)
			s.fate.known = max(s.fate.known, top.size())
			emit(s, {"t": "fate", "action": "arrange", "n": d.cards.size()})
			return null
		"rejudge":
			if a.type != "rejudge":
				return "expected rejudge"
			s.pending = null
			s.pendingCtx = null
			if a.get("sign") != null:
				var removed = MqU.js_splice(s.fate.signs, a.sign, 1)
				var now = removed[0] if not removed.is_empty() else null
				if now != null:
					s.fate.discard.append(eff.card)
					emit(s, {"t": "rejudge", "old": eff.card, "now": now, "side": "player"})
					fire(s, "rejudged", {"side": "player", "suit": now.suit})
					eff.card = now
			return null
	return "unhandled"

# ═════════════ chains & responses ═════════════

static func response_options(s: Dictionary, chain: Dictionary) -> Array:
	var tut = s.cfg.get("tutorial")
	if tut != null and tut.get("noResponse") == true:
		return []
	var top = MqU.at(chain.links, chain.links.size() - 1)
	if top == null:
		return []
	var top_side: String
	if top.kind == "move":
		top_side = "enemy"
	elif top.kind == "attack":
		var au = MqBoard.unit(s, top.attacker)
		top_side = au.side if au != null else "player"
	else:
		top_side = top.side
	if top_side != "enemy":
		return []
	if chain.links.size() >= 4:
		return []
	var out = []
	for card in s.hand:
		var d = card_def(card)
		if not is_response(d) or d.get("unplayable") == true:
			continue
		var plan = plan_payment(s, effective_cost(s, card), card)
		if plan == null:
			continue
		var tg = card_targets(s, "player", d)
		if tg != null and tg.is_empty():
			continue
		out.append(card.uid)
	return out

static func is_response(d: Dictionary) -> bool:
	if d.type == "response":
		return true
	var kws = d.get("keywords")
	return kws != null and kws.has("response")

static func step_chain(s: Dictionary, task: Dictionary) -> void:
	if task.stage == "window":
		var opts = response_options(s, task)
		if not opts.is_empty() and s.get("autoSkipResponse") != true:
			var top: Dictionary = task.links[task.links.size() - 1]
			var actor
			if top.kind == "move":
				actor = top.uid
			elif top.kind == "attack":
				actor = top.attacker
			else:
				actor = s.sides[top.side].commander
			s.pending = {"kind": "response", "actor": actor, "target": top.get("target"), "options": opts, "timer": 8}
			s.pendingCtx = {"task": MqU.idx_same(s.tasks, task), "effect": null}
			emit(s, {"t": "window", "open": true, "actor": actor})
			return
		task.stage = "resolve"
		return
	if task.stage == "resolve":
		var link = MqU.pop(task.links)
		if link == null:
			s.tasks.pop_back()
			return
		if task.links.is_empty():
			task.resolvedBase = link
		if link.get("cancelled") == true:
			emit(s, {"t": "cancel", "what": link.kind})
			if link.kind == "card":
				finish_cancelled_card(s, link)
			return
		resolve_link(s, task, link)

static func finish_cancelled_card(s: Dictionary, link: Dictionary) -> void:
	for k in s.limbo.size():
		if s.limbo[k].uid == link.card.uid:
			s.limbo.remove_at(k)
			break
	if link.side == "player":
		s.discard.append(strip_temp(link.card))
	emit(s, {"t": "cardDone", "card": link.card, "to": "discard"})

static func declared_for(task: Dictionary, idx: int):
	var below = MqU.at(task.links, idx - 1)
	if below == null:
		return null
	if below.kind == "move":
		return {"actor": below.uid, "target": below.target, "link": idx - 1}
	if below.kind == "attack":
		return {"actor": below.attacker, "target": below.target, "link": idx - 1}
	return {"actor": null, "target": below.get("target"), "link": idx - 1}

static func resolve_link(s: Dictionary, task: Dictionary, link: Dictionary) -> void:
	var idx: int = task.links.size() # index the link had
	match link.kind:
		"card":
			var d = card_def(link.card)
			var ctx = card_ctx(s, link.side, link.card, link.target, link.x)
			ctx.inWindow = link.get("inWindow") == true
			ctx.declared = declared_for(task, idx)
			var effs = []
			if d.type == "unit":
				effs.append({"op": "__summonCard", "slot": link.get("slot")})
			if d.type == "equip":
				effs.append({"op": "__equipCard"})
			if d.type == "delay":
				effs.append({"op": "__attachDelay"})
			if d.type == "field":
				effs.append({"op": "__setField"})
			if d.get("effects") != null:
				effs.append_array(d.effects)
			effs.append({"op": "__finishCard", "exhaust": false})
			push_fx(s, effs, ctx)
		"move":
			var u = MqBoard.unit(s, link.uid)
			if not MqBoard.alive(u):
				return
			var mv = MqIntents.enemy_moves(u).get(link.move)
			if mv == null:
				return
			if u.statuses.get("stun", 0) > 0:
				u.statuses.erase("stun")
				u.stunImmune = 2
				emit(s, {"t": "status", "target": u.uid, "status": "stun", "delta": -1, "total": 0})
				emit(s, {"t": "stunned", "uid": u.uid})
				return
			if u.statuses.get("freeze", 0) > 0 and mv.intent.has("attack"):
				emit(s, {"t": "frozen", "uid": u.uid})
				return
			s.acted = true
			push_fx(s, mv.effects, {"side": u.side, "source": u.uid, "kind": "move", "target": link.target, "vars": {"atk": MqBoard.atk_of(s, u)}})
		"attack":
			var au = MqBoard.unit(s, link.attacker)
			push_fx(s, [{"op": "__attack", "attacker": link.attacker, "target": link.target}], base_ctx(s, au.side if au != null else "player", "system"))
		"skill":
			var sk = MqU.at(s.skills, link.skill)
			var d = MqSkills.skill_def(s, sk) if sk != null else null
			if d == null:
				return
			push_fx(s, MqU.nz(d.get("effects"), []), base_ctx(s, link.side, "skill", {"target": link.target, "owner": {"kind": "skill", "ref": link.skill}}))

static func answer_response(s: Dictionary, a: Dictionary):
	var pc: Dictionary = s.pendingCtx
	var task = MqU.at(s.tasks, pc.task)
	if task == null or task.k != "chain":
		return "bad chain"
	if a.type == "pass":
		s.pending = null
		s.pendingCtx = null
		task.stage = "resolve"
		emit(s, {"t": "window", "open": false})
		return null
	if a.type != "respond":
		return "expected respond/pass"
	var card = null
	for c in s.hand:
		if c.uid == a.get("card"):
			card = c
			break
	if card == null or not s.pending.options.has(card.uid):
		return "not a legal response"
	var d = card_def(card)
	var tg = card_targets(s, "player", d)
	var target = a.get("target")
	if tg != null and (target == null or not tg.has(target)):
		return "bad target"
	var need = effective_cost(s, card)
	var plan = plan_payment(s, need, card)
	if plan == null:
		return "cannot pay"
	s.pending = null
	s.pendingCtx = null
	var x = plan.size() - need.c.size() if need.x else 0
	pay_sources(s, plan)
	s.nextCardCostMod = 0
	s.hand.remove_at(MqU.idx_same(s.hand, card))
	s.limbo.append(card)
	task.links.append({"kind": "card", "side": "player", "card": card, "target": target, "slot": null, "x": x, "inWindow": true})
	s.stats.responses += 1
	emit(s, {"t": "response", "side": "player", "card": card})
	emit(s, {"t": "window", "open": false})
	fire(s, "responsePlayed", {"side": "player", "card": card})
	return null

# ═════════════ turn flow ═════════════

static func step_phase(s: Dictionary, name: String) -> void:
	s.tasks.pop_back()
	match name:
		"combatStart":
			for u in MqBoard.units_of(s, "enemy", true):
				if u.get("intent") == null:
					MqIntents.roll_intent(s, u)
			fire(s, "combatStart", {"side": "player"})
		"playerTurnStart":
			s.turn += 1
			s.stats.turns = s.turn
			s.active = "player"
			s.stats.judgesThisTurn = {}
			s.sacrificesThisTurn = 0
			s.cardsPlayedThisTurn = 0
			for k in s.triggerUse.keys():
				if not String(k).begins_with("combat:"):
					s.triggerUse.erase(k)
			emit(s, {"t": "turn", "side": "player", "turn": s.turn})
			s.sources = s.sources.filter(func(x): return x.get("temp") != true)
			for src in s.sources:
				src.ready = true
			emit(s, {"t": "sources", "sources": copy_sources(s)})
			for sk in s.skills:
				sk.used = false
			s.tasks.append({"k": "phase", "name": "playerDraw"})
			start_of_turn(s, "player")
		"playerDraw":
			draw_cards(s, 5 + MqBoard.sum_mods(s, "draw", "player"))
		"playerTurnEnd":
			s.tasks.append({"k": "phase", "name": "playerCleanup"})
			end_of_turn(s, "player")
		"playerCleanup":
			# embers
			var cap = ember_cap(s)
			s.sources = s.sources.filter(func(x): return x.get("temp") != true)
			var ready = []
			for i in s.sources.size():
				if s.sources[i].ready:
					ready.append({"x": s.sources[i], "i": i})
			var wanted = {}
			for c in s.hand:
				var d = card_def(c)
				if is_response(d) and d.cost.get("c") != null:
					for col in d.cost.c:
						wanted[col] = true
			ready = MqU.stable_sort(ready, func(a, b): return MqU.cmp_or((0 if wanted.has(a.x.color) else 1) - (0 if wanted.has(b.x.color) else 1), a.i - b.i))
			for k in ready.size():
				if k >= cap:
					ready[k].x.ready = false
			emit(s, {"t": "sources", "sources": copy_sources(s)})
			emit(s, {"t": "embers", "count": min(cap, ready.size())})
			# hand
			var retain_all = MqBoard.sum_mods(s, "retainHand", "player") > 0
			for c in s.hand.duplicate():
				var d = card_def(c)
				var kws: Array = MqU.nz(d.get("keywords"), [])
				if kws.has("ethereal") or c.get("fleeting") == true:
					exhaust_card(s, c)
					continue
				if kws.has("retain") or retain_all:
					continue
				if is_response(d):
					c.held = true
					continue
				discard_card(s, c)
			for c in s.hand + s.draw + s.discard:
				if c.get("costModUntil") == "turn":
					c.costMod = 0
					c.erase("costModUntil")
			for c in s.hand:
				if c.get("free") == true:
					c.erase("free")
			s.nextCardCostMod = 0
			s.tasks.append({"k": "phase", "name": "enemyTurnStart"})
		"enemyTurnStart":
			s.active = "enemy"
			emit(s, {"t": "turn", "side": "enemy", "turn": s.turn})
			advance_enemies(s)
			s.tasks.append({"k": "phase", "name": "enemyActions"})
			start_of_turn(s, "enemy")
		"enemyActions":
			s.tasks.append({"k": "phase", "name": "enemyTurnEnd"})
			var order = MqBoard.units_of(s, "enemy", true)
			var i = order.size() - 1
			while i >= 0:
				s.tasks.append({"k": "enemyAct", "uid": order[i].uid})
				i -= 1
		"enemyTurnEnd":
			s.tasks.append({"k": "phase", "name": "playerTurnStart"})
			end_of_turn(s, "enemy")
			for src in s.sources:
				src.ready = false
			for c in s.hand.duplicate():
				if c.get("held") == true:
					c.erase("held")
					discard_card(s, c)
			for u in MqBoard.units_of(s, "enemy", true):
				MqIntents.roll_intent(s, u)

static func advance_enemies(s: Dictionary) -> void:
	var sd: Dictionary = s.sides.enemy
	for j in MqBoard.BACK:
		var u = MqBoard.unit(s, sd.back[j])
		if not MqBoard.alive(u) or u.origin != "enemy" or MqBoard.has_kw(s, u, "ranged"):
			continue
		if MqContent.enemy(u.def).row == "back":
			continue
		var free = MqBoard.empty_slots(s, "enemy", "front")
		if free.is_empty():
			return
		var ns: int = j if free.has(j) else (j + 1 if free.has(j + 1) else free[0])
		sd.back[j] = null
		sd.front[ns] = u.uid
		u.row = "front"
		u.slot = ns
		emit(s, {"t": "move", "uid": u.uid, "row": "front", "slot": ns})

static func start_of_turn(s: Dictionary, side: String) -> void:
	s.acted = false
	var chars = MqBoard.board_order(s, side)
	# armor expires — except on the player's very first turn
	var keep = 0
	if side == "player":
		keep = 999 if s.turn <= 1 else MqBoard.sum_mods(s, "armorKeep", "player")
	for u in chars:
		if u.armor > 0:
			var kept = u.armor if keep >= 999 else min(u.armor, keep)
			u.lostArmor = u.armor - kept
			if kept != u.armor:
				u.armor = kept
				emit(s, {"t": "armor", "target": u.uid, "amount": 0, "armor": u.armor})
		else:
			u.lostArmor = 0
		u.attacks = 0
	# growth
	for u in chars:
		if u.growth > 0 and not u.silenced and u.kind == "unit":
			u.atkBuff += u.growth
			u.hpBuff += u.growth
			u.hp += u.growth
			emit(s, {"t": "keyword", "target": u.uid, "keyword": "growth"})
			emit(s, {"t": "stats", "target": u.uid, "atk": MqBoard.atk_of(s, u), "hp": u.hp, "maxHp": MqBoard.max_hp_of(s, u)})
	# burn
	for u in chars:
		var b = u.statuses.get("burn", 0)
		if b > 0 and MqBoard.alive(u):
			deal_damage(s, null, u.uid, b, "burn")
			emit(s, {"t": "keyword", "target": u.uid, "keyword": "burn"})
			var keep_burn = MqBoard.sum_mods(s, "burnKeep", u.side, u) > 0
			var nb = b if keep_burn else MqU.floori(MqU.fdiv(b, 2))
			if nb <= 0:
				u.statuses.erase("burn")
			else:
				u.statuses.burn = nb
			emit(s, {"t": "status", "target": u.uid, "status": "burn", "delta": nb - b, "total": nb})
	check_state(s)
	if s.over != null:
		return
	# field duration
	var f = s.sides[side].field
	if f != null and f.turns != null:
		f.turns -= 1
		if f.turns <= 0:
			s.sides[side].field = null
			emit(s, {"t": "field", "side": side, "card": null})
			if side == "player":
				s.discard.append({"uid": f.uid, "id": f.card, "up": f.up})
	# delays (queued in board order, first resolves first)
	var jobs = []
	for u in chars:
		if not MqBoard.alive(u):
			continue
		for d in u.delays.duplicate():
			d.turns -= 1
			emit(s, {"t": "delayTick", "target": u.uid, "card": d.card, "turns": d.turns})
			if d.turns <= 0:
				u.delays.remove_at(MqU.idx_same(u.delays, d))
				var dd = MqContent.card(d.card, d.up)
				if d.owner == "player":
					s.discard.append({"uid": d.uid, "id": d.card, "up": d.up})
				var vars = {}
				if dd.get("vars") != null:
					vars = dd.vars.duplicate(false)
				jobs.append({
					"effs": [{"op": "judge", "branches": dd.delay.branches, "target": "target"}],
					"ctx": {"side": d.owner, "source": s.sides[d.owner].commander, "kind": "delay", "target": u.uid, "vars": vars, "defId": d.card, "up": d.up},
				})
	var i = jobs.size() - 1
	while i >= 0:
		push_fx(s, jobs[i].effs, jobs[i].ctx)
		i -= 1
	fire(s, "turnStart", {"side": side})

static func end_of_turn(s: Dictionary, side: String) -> void:
	var chars = MqBoard.board_order(s, side)
	for u in chars:
		var p = u.statuses.get("poison", 0)
		if p > 0:
			deal_damage(s, null, u.uid, p, "poison")
			emit(s, {"t": "keyword", "target": u.uid, "keyword": "poison"})
			dec_status(s, u, "poison")
		var r = u.statuses.get("regen", 0)
		if r > 0 and MqBoard.alive(u):
			heal(s, u.uid, r)
			dec_status(s, u, "regen")
	for u in chars:
		# stun = "skip the next action": player characters spend it by sitting out one player turn
		if side == "player" and u.statuses.get("stun", 0) > 0:
			u.statuses.erase("stun")
			u.stunImmune = 2
			emit(s, {"t": "status", "target": u.uid, "status": "stun", "delta": -1, "total": 0})
		for st in ["freeze", "vulnerable", "weak"]:
			var fr = u.get("fresh")
			if fr != null and fr.get(st) == true:
				fr.erase(st)
				continue
			if u.statuses.get(st, 0) > 0:
				dec_status(s, u, st)
		if u.stunImmune > 0:
			u.stunImmune -= 1
		if MqU.truthy(u.tempAtk):
			u.tempAtk = 0
			emit(s, {"t": "stats", "target": u.uid, "atk": MqBoard.atk_of(s, u), "hp": u.hp, "maxHp": MqBoard.max_hp_of(s, u)})
	check_state(s)
	if s.over != null:
		return
	fire(s, "turnEnd", {"side": side})

static func dec_status(s: Dictionary, u: Dictionary, st: String) -> void:
	var v = u.statuses.get(st, 0) - 1
	if v <= 0:
		u.statuses.erase(st)
	else:
		u.statuses[st] = v
	emit(s, {"t": "status", "target": u.uid, "status": st, "delta": -1, "total": max(0, v)})

static func step_enemy_act(s: Dictionary, uid) -> void:
	s.tasks.pop_back()
	var u = MqBoard.unit(s, uid)
	if not MqBoard.alive(u) or u.get("intent") == null:
		return
	var mv = MqIntents.enemy_moves(u).get(u.intent.move)
	if mv == null:
		return
	if u.statuses.get("stun", 0) > 0:
		u.statuses.erase("stun")
		u.stunImmune = 2
		emit(s, {"t": "status", "target": u.uid, "status": "stun", "delta": -1, "total": 0})
		emit(s, {"t": "stunned", "uid": u.uid})
		return
	if u.statuses.get("freeze", 0) > 0 and mv.intent.has("attack"):
		emit(s, {"t": "frozen", "uid": u.uid})
		return
	var target = MqIntents.retarget(s, u, mv)
	u.intent.target = target
	emit(s, {"t": "declare", "uid": u.uid, "move": u.intent.move, "target": target})
	fire(s, "actionDeclared", {"subject": u.uid, "side": "enemy", "target": target, "source": u.uid})
	s.tasks.append({"k": "chain", "stage": "window", "links": [{"kind": "move", "uid": u.uid, "move": u.intent.move, "target": target}], "passes": 0, "origin": "enemy"})

# ═════════════ main loop ═════════════

static func run(s: Dictionary) -> void:
	var guard = 0
	while s.pending == null and s.over == null:
		if abort:
			return
		guard += 1
		if guard > 50000:
			fail("engine loop overflow")
			return
		var top = s.tasks[s.tasks.size() - 1] if not s.tasks.is_empty() else null
		if top == null or top.k != "fx":
			var t = MqU.shift(s.triggers)
			if t != null:
				push_fx(s, t.effects, t.ctx)
				continue
			if s.get("ending") == true:
				s.over = "win"
				s.phase = "over"
				emit(s, {"t": "end", "result": "win"})
				return
			if enemy_defeated(s):
				s.ending = true
				# remaining minions flee
				for u in MqBoard.units_of(s, "enemy"):
					remove_from_board(s, u)
					emit(s, {"t": "death", "uid": u.uid})
				fire(s, "combatEnd", {"side": "player"})
				continue
		if top == null:
			s.phase = "main"
			return
		s.phase = "busy"
		match top.k:
			"fx":
				if top.i >= top.effects.size():
					s.tasks.pop_back()
					check_state(s)
				else:
					var eff = top.effects[top.i]
					top.i += 1
					exec_effect(s, top, eff)
			"phase":
				step_phase(s, top.name)
			"enemyAct":
				step_enemy_act(s, top.uid)
			"chain":
				step_chain(s, top)
