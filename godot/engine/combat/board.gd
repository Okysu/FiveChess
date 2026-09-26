## Port of src/engine/combat/board.ts — board geometry, unit stats and continuous modifiers.
class_name MqBoard
extends RefCounted

const FRONT := 4
const BACK := 3
const _ALL_KW := ["taunt", "ranged", "leap", "haste", "twinStrike", "lifesteal", "deathtouch", "stealth"]

static func unit(s: Dictionary, uid):
	if uid == null:
		return null
	var u = s.units.get(uid)
	if u == null or u.get("removed") == true:
		return null
	return u

static func alive(u) -> bool:
	return u != null and u.get("removed") != true and u.get("dead") != true and u.hp > 0

static func commander_of(s: Dictionary, side: String):
	return unit(s, s.sides[side].commander)

static func units_of(s: Dictionary, side: String, include_commander := false) -> Array:
	var sd: Dictionary = s.sides[side]
	var out = []
	if include_commander:
		var c = unit(s, sd.commander)
		if alive(c):
			out.append(c)
	for id in sd.front:
		var u = unit(s, id)
		if alive(u):
			out.append(u)
	for id in sd.back:
		var u = unit(s, id)
		if alive(u):
			out.append(u)
	return out

## board order used for deterministic iteration: commander -> front L->R -> back L->R
static func board_order(s: Dictionary, side: String) -> Array:
	return units_of(s, side, true)

static func row_non_empty(s: Dictionary, side: String, row: String) -> bool:
	for id in s.sides[side][row]:
		if alive(unit(s, id)):
			return true
	return false

static func empty_slots(s: Dictionary, side: String, row: String) -> Array:
	var arr: Array = s.sides[side][row]
	var out = []
	for i in arr.size():
		if not alive(unit(s, arr[i])):
			out.append(i)
	return out

static func depth(s: Dictionary, u: Dictionary) -> int:
	if u.row == "front":
		return 1
	var f = row_non_empty(s, u.side, "front")
	if u.row == "back":
		return 2 if f else 1
	var b = row_non_empty(s, u.side, "back")
	var d = 1 + (1 if f else 0) + (1 if b else 0)
	if s.sides[u.side].equip.get("mount") != null and mount_kind(s, u.side) == "defense":
		d += 1
	return d

static func mount_kind(s: Dictionary, side: String):
	var m = s.sides[side].equip.get("mount")
	if m == null:
		return null
	var eq = MqContent.card(m.card, m.up).get("equip")
	return eq.get("mount") if eq != null else null

static func has_kw(s: Dictionary, u: Dictionary, k: String) -> bool:
	if u.extraKeywords.has(k):
		return true
	if u.silenced:
		return false
	if base_keywords(u).has(k):
		return true
	# aura / modifier-granted
	for m in mods_for(s, "keyword", u):
		if m.get("keyword") == k:
			return true
	return false

static func base_keywords(u: Dictionary) -> Array:
	if u.origin == "enemy":
		var kw = MqContent.enemy(u.def).get("keywords")
		return kw if kw != null else []
	if u.origin == "card" or u.origin == "token":
		var ud = MqContent.card(u.def, u.up).get("unit")
		if ud != null and ud.get("keywords") != null:
			return ud.keywords
	return []

static func keywords_of(s: Dictionary, u: Dictionary) -> Array:
	var out = []
	for k in _ALL_KW:
		if has_kw(s, u, k):
			out.append(k)
	if u.thorns > 0 and not u.silenced:
		out.append("thorns")
	if u.growth > 0 and not u.silenced:
		out.append("growth")
	if u.ward > 0:
		out.append("ward")
	return out

static func reach(s: Dictionary, u: Dictionary) -> int:
	if u.kind == "commander":
		if u.side == "enemy":
			return 99
		var w = s.sides[u.side].equip.get("weapon")
		if w == null:
			return 0
		var d: Dictionary = MqContent.card(w.card, w.up).equip
		var r = MqU.nz(d.get("range"), 1) + w.rangeBonus
		if mount_kind(s, u.side) == "offense":
			r += 1
		r += sum_mods(s, "range", u.side, u)
		return r
	if has_kw(s, u, "ranged") or has_kw(s, u, "leap"):
		return 99
	return 1 if u.row == "front" else 0

static func adjacent_units(s: Dictionary, u: Dictionary) -> Array:
	if u.kind == "commander":
		return []
	var sd: Dictionary = s.sides[u.side]
	var ids = []
	var sl: int = u.slot
	if u.row == "front":
		ids.append(MqU.at(sd.front, sl - 1))
		ids.append(MqU.at(sd.front, sl + 1))
		# back slot j touches front j and j+1
		ids.append(MqU.at(sd.back, sl - 1))
		ids.append(MqU.at(sd.back, sl))
	else:
		ids.append(MqU.at(sd.back, sl - 1))
		ids.append(MqU.at(sd.back, sl + 1))
		ids.append(MqU.at(sd.front, sl))
		ids.append(MqU.at(sd.front, sl + 1))
	var out = []
	for id in ids:
		var x = unit(s, id)
		if alive(x):
			out.append(x)
	return out

# ───────────── modifiers ─────────────

## collect every continuous modifier currently on the battlefield: [{mod, ownerSide, owner}]
static func all_modifiers(s: Dictionary) -> Array:
	var out = []
	var pc = commander_of(s, "player")
	for r in s.relics:
		if r.get("disabled") == true:
			continue
		var mods = MqContent.relic(r.id).get("modifiers")
		if mods != null:
			for m in mods:
				out.append({"mod": m, "ownerSide": "player", "owner": pc})
	for sk in s.skills:
		var d = MqSkills.skill_def(s, sk)
		if d != null and d.get("modifiers") != null:
			for m in d.modifiers:
				out.append({"mod": m, "ownerSide": "player", "owner": pc})
	for side in ["player", "enemy"]:
		var sd: Dictionary = s.sides[side]
		var cmd = commander_of(s, side)
		for slot in sd.equip:
			var eq = sd.equip[slot]
			if eq == null:
				continue
			var e = MqContent.card(eq.card, eq.up).get("equip")
			if e != null and e.get("modifiers") != null:
				for m in e.modifiers:
					out.append({"mod": m, "ownerSide": side, "owner": cmd})
		if sd.field != null:
			var fd = MqContent.card(sd.field.card, sd.field.up).get("field")
			if fd != null and fd.get("modifiers") != null:
				for m in fd.modifiers:
					out.append({"mod": m, "ownerSide": side, "owner": cmd})
		for u in units_of(s, side, true):
			if u.silenced:
				continue
			if u.origin == "enemy":
				var em = MqContent.enemy(u.def).get("modifiers")
				if em != null:
					for m in em:
						out.append({"mod": m, "ownerSide": side, "owner": u})
			elif u.origin == "card" or u.origin == "token":
				var ud = MqContent.card(u.def, u.up).get("unit")
				if ud != null:
					if ud.get("modifiers") != null:
						for m in ud.modifiers:
							out.append({"mod": m, "ownerSide": side, "owner": u})
					if ud.get("aura") != null:
						for m in ud.aura:
							var m2: Dictionary = m.duplicate(false)
							m2.who = MqU.nz(m.get("who"), "adjacent")
							out.append({"mod": m2, "ownerSide": side, "owner": u})
	return out

static func mod_applies(s: Dictionary, src: Dictionary, for_side: String, target) -> bool:
	var who = MqU.nz(src.mod.get("who"), "friendly")
	var owner = src.owner
	match who:
		"all":
			return true
		"friendly":
			return for_side == src.ownerSide
		"enemy":
			return for_side == MqState.other(src.ownerSide)
		"self":
			return target != null and owner != null and target.uid == owner.uid
		"commander":
			return target != null and target.kind == "commander" and target.side == src.ownerSide
		"friendlyUnits":
			return target != null and target.kind == "unit" and target.side == src.ownerSide and (owner == null or target.uid != owner.uid)
		"enemyUnits":
			return target != null and target.kind == "unit" and target.side == MqState.other(src.ownerSide)
		"adjacent":
			if target == null or owner == null or owner.kind != "unit":
				return false
			for a in adjacent_units(s, owner):
				if a.uid == target.uid:
					return true
			return false
	return false

static func mods_for(s: Dictionary, stat: String, target: Dictionary) -> Array:
	var out = []
	for src in all_modifiers(s):
		if src.mod.stat != stat:
			continue
		if not mod_applies(s, src, target.side, target):
			continue
		if src.mod.get("if") != null and not MqEval.eval_cond(s, src.mod["if"], mod_ctx(src, target)):
			continue
		out.append(src.mod)
	return out

static func mod_ctx(src: Dictionary, target) -> Dictionary:
	return {"side": src.ownerSide, "source": src.owner.uid if src.owner != null else null, "kind": "system",
		"target": target.uid if target != null else null, "vars": {}}

## sum a side-level modifier (e.g. emberCap, draw) — target is the side's commander when relevant
static func sum_mods(s: Dictionary, stat: String, side: String, target = null, card = null):
	var total = 0
	var tgt = target if target != null else commander_of(s, side)
	for src in all_modifiers(s):
		var mod: Dictionary = src.mod
		if mod.stat != stat:
			continue
		var who = MqU.nz(mod.get("who"), "friendly")
		if tgt != null:
			if not mod_applies(s, src, side, tgt):
				continue
		elif not (who == "all" or (who == "friendly" and side == src.ownerSide) or (who == "enemy" and side != src.ownerSide)):
			continue
		if card != null and mod.get("filter") != null:
			var d = MqContent.card(card.id, card.up)
			if not MqContent.match_card(d, mod.filter):
				continue
		elif card == null and mod.get("filter") != null:
			continue
		if mod.get("if") != null and not MqEval.eval_cond(s, mod["if"], mod_ctx(src, tgt)):
			continue
		total += 1 if mod.get("amount") == null else MqEval.eval_value(s, mod.amount, mod_ctx(src, tgt))
	return total

# ───────────── stats ─────────────

static func atk_of(s: Dictionary, u: Dictionary):
	var a = u.baseAtk + u.atkBuff + u.tempAtk
	if u.kind == "commander" and u.side == "player":
		var w = s.sides[u.side].equip.get("weapon")
		if w != null:
			var e = MqContent.card(w.card, w.up).get("equip")
			a += (MqU.nz(e.get("atk"), 0) if e != null else 0) + w.atkBonus
	for m in mods_for(s, "atk", u):
		a += MqEval.eval_value(s, MqU.nz(m.get("amount"), 0), {"side": u.side, "source": u.uid, "kind": "system", "target": u.uid, "vars": {}})
	return max(0, a)

static func max_hp_of(s: Dictionary, u: Dictionary):
	var h = u.baseMaxHp + u.hpBuff
	if u.kind == "unit":
		for m in mods_for(s, "maxHp", u):
			h += MqEval.eval_value(s, MqU.nz(m.get("amount"), 0), {"side": u.side, "source": u.uid, "kind": "system", "target": u.uid, "vars": {}})
	return max(1, h)

static func status(u: Dictionary, st: String):
	return u.statuses.get(st, 0)

static func snap(s: Dictionary, u: Dictionary) -> Dictionary:
	return {
		"uid": u.uid, "side": u.side, "kind": u.kind, "def": u.def, "name": u.name, "row": u.row, "slot": u.slot,
		"atk": atk_of(s, u), "hp": u.hp, "maxHp": max_hp_of(s, u), "armor": u.armor, "ward": u.ward,
		"keywords": keywords_of(s, u), "up": u.up,
	}

## can this unit attack right now (ignoring targets)?
static func can_attack(s: Dictionary, u: Dictionary) -> bool:
	if not alive(u):
		return false
	if status(u, "freeze") > 0 or status(u, "stun") > 0:
		return false
	if atk_of(s, u) <= 0:
		return false
	var max_attacks = 2 if has_kw(s, u, "twinStrike") else 1
	if u.attacks >= max_attacks:
		return false
	if u.kind == "unit" and u.enteredTurn == s.turn and u.side == s.active and not has_kw(s, u, "haste"):
		return false
	if reach(s, u) <= 0:
		return false
	return true

## legal targets for an attack by u (respecting depth, reach, taunt, stealth)
static func attack_targets(s: Dictionary, u: Dictionary, ignore_reach := false) -> Array:
	var foes = []
	for f in units_of(s, MqState.other(u.side), true):
		if not f.stealth:
			foes.append(f)
	var r = 99 if ignore_reach else reach(s, u)
	var in_reach = []
	for f in foes:
		if depth(s, f) <= r:
			in_reach.append(f)
	if has_kw(s, u, "leap"):
		return foes
	var taunts = []
	for f in in_reach:
		if f.kind == "unit" and has_kw(s, f, "taunt"):
			taunts.append(f)
	return taunts if not taunts.is_empty() else in_reach
