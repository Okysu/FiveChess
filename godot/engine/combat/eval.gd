## Port of src/engine/combat/eval.ts — value expressions, selectors and conditions of the effect DSL.
class_name MqEval
extends RefCounted

static func eval_value(s: Dictionary, v, ctx: Dictionary):
	match typeof(v):
		TYPE_INT, TYPE_FLOAT:
			return v
		TYPE_STRING:
			var key: String = v.substr(1)
			if key == "x":
				return MqU.nz(ctx.get("x"), 0)
			var n = ctx.vars.get(key)
			if n == null:
				MqCore.fail("unknown var " + v)
				return 0
			return n
		TYPE_NIL:
			MqCore.fail("undefined value")
			return 0
	if v.has("add"):
		var t = 0
		for x in v.add:
			t = t + eval_value(s, x, ctx)
		return t
	if v.has("mul"):
		var t = 1
		for x in v.mul:
			t = t * eval_value(s, x, ctx)
		return MqU.floori(t)
	if v.has("sub"):
		return eval_value(s, v.sub[0], ctx) - eval_value(s, v.sub[1], ctx)
	if v.has("div"):
		var d = eval_value(s, v.div[1], ctx)
		if d == 0:
			return 0
		return MqU.floori(MqU.fdiv(eval_value(s, v.div[0], ctx), d))
	if v.has("max"):
		var best = -INF
		for x in v.max:
			var e = eval_value(s, x, ctx)
			if e > best:
				best = e
		return best
	if v.has("min"):
		var best = INF
		for x in v.min:
			var e = eval_value(s, x, ctx)
			if e < best:
				best = e
		return best
	var side: String = MqState.other(ctx.side) if v.get("side") == "enemy" else ctx.side
	match v.count:
		"hand":
			return s.hand.size() if ctx.side == "player" else s.sides.enemy.hand.size()
		"drawPile":
			return s.draw.size()
		"discardPile":
			return s.discard.size()
		"exhaustPile":
			return s.exhaust.size()
		"sources":
			var n = 0
			for x in s.sources:
				if x.get("temp") != true and (not MqU.truthy(v.get("color")) or x.color == v.color):
					n += 1
			return n
		"readySources":
			var n = 0
			for x in s.sources:
				if x.ready:
					n += 1
			return n
		"embers":
			if s.active != "enemy":
				return 0
			var n = 0
			for x in s.sources:
				if x.ready:
					n += 1
			return n
		"units":
			var n = 0
			for u in MqBoard.units_of(s, side):
				if not MqU.truthy(v.get("row")) or u.row == v.row:
					n += 1
			return n
		"cardsPlayed":
			return s.cardsPlayedThisTurn
		"status":
			var u = _one(s, v, ctx)
			return u.statuses.get(v.status, 0) if u != null and MqU.truthy(v.get("status")) else 0
		"armor":
			var u = _one(s, v, ctx)
			return u.armor if u != null else 0
		"atk":
			var u = _one(s, v, ctx)
			return MqBoard.atk_of(s, u) if u != null else 0
		"hp":
			var u = _one(s, v, ctx)
			return u.hp if u != null else 0
		"maxHp":
			var u = _one(s, v, ctx)
			return MqBoard.max_hp_of(s, u) if u != null else 0
		"missingHp":
			var u = _one(s, v, ctx)
			return MqBoard.max_hp_of(s, u) - u.hp if u != null else 0
		"signs":
			return s.fate.signs.size() if ctx.side == "player" else s.sides.enemy.signs.size()
		"judgeRank":
			return ctx.judge.rank if ctx.get("judge") != null else 0
		"x":
			return MqU.nz(ctx.get("x"), 0)
		"lastDamage":
			return MqU.nz(ctx.get("lastDamage"), 0)
		"turn":
			return s.turn
		"sacrificed":
			return s.sacrificed.size()
		"eventAmount":
			return ctx.event.amount if ctx.get("event") != null and ctx.event.get("amount") != null else 0
		"judgesThisTurn":
			var j: Dictionary = s.stats.judgesThisTurn
			if not MqU.truthy(v.get("suit")):
				return MqU.sum_values(j)
			var suits: Array
			if v.suit == "yang":
				suits = MqDefs.YANG.duplicate()
			elif v.suit == "yin":
				suits = ["moon", "mountain"]
			else:
				suits = [v.suit]
			var t = 0
			for b in suits:
				t += j.get(b, 0)
			return t
		"equipped":
			var n = 0
			for k in s.sides[side].equip:
				if s.sides[side].equip[k] != null:
					n += 1
			return n
		"delays":
			var u = _one(s, v, ctx)
			return u.delays.size() if u != null else 0
		"counter":
			var ow = ctx.get("owner")
			if ow != null and ow.kind == "relic":
				for r in s.relics:
					if r.id == ow.ref:
						return r.counter
				return 0
			if ow != null and ow.kind == "unit":
				var u = MqBoard.unit(s, ow.ref)
				return u.counter if u != null else 0
			return 0
		"deadThisCombat":
			return s.stats.dead
		"responsesThisCombat":
			return s.stats.responses
		"weaponAtk":
			var w = s.sides[side].equip.get("weapon")
			if w == null:
				return 0
			var e = MqContent.card(w.card, w.up).get("equip")
			return (MqU.nz(e.get("atk"), 0) if e != null else 0) + w.atkBonus
		"selected":
			return MqU.nz(ctx.get("selected"), 0)
	return null

static func _one(s: Dictionary, v: Dictionary, ctx: Dictionary):
	if v.get("of") != null:
		return MqU.at(select(s, v.of, ctx), 0)
	return MqBoard.unit(s, ctx.source)

static func side_units(s: Dictionary, side: String, ctx: Dictionary, kind: String) -> Array:
	var sides: Array
	if side == "both":
		sides = [ctx.side, MqState.other(ctx.side)]
	elif side == "friendly":
		sides = [ctx.side]
	else:
		sides = [MqState.other(ctx.side)]
	var out = []
	for sd in sides:
		if kind == "commander":
			var c = MqBoard.commander_of(s, sd)
			if MqBoard.alive(c):
				out.append(c)
		else:
			out.append_array(MqBoard.units_of(s, sd, kind == "character"))
	return out

## targeting by the opposing side cannot pick stealthed units
static func visible(ctx: Dictionary, list: Array) -> Array:
	var out = []
	for u in list:
		if not (u.stealth and u.side != ctx.side):
			out.append(u)
	return out

static func _one_of(s: Dictionary, id) -> Array:
	var u = MqBoard.unit(s, id)
	return [u] if MqBoard.alive(u) else []

static func _ev(ctx: Dictionary, k: String):
	var e = ctx.get("event")
	return e.get(k) if e != null else null

static func _decl(ctx: Dictionary, k: String):
	var e = ctx.get("declared")
	return e.get(k) if e != null else null

static func select(s: Dictionary, sel, ctx: Dictionary) -> Array:
	if typeof(sel) == TYPE_DICTIONARY:
		return select_query(s, sel, ctx)
	match sel:
		"none":
			return []
		"self":
			return _one_of(s, ctx.source)
		"commander":
			return _one_of(s, s.sides[ctx.side].commander)
		"enemyCommander":
			return _one_of(s, s.sides[MqState.other(ctx.side)].commander)
		"target":
			return _one_of(s, ctx.get("target"))
		"it":
			return _one_of(s, ctx.get("it"))
		"eventSource":
			return _one_of(s, _ev(ctx, "source"))
		"eventTarget":
			return _one_of(s, _ev(ctx, "target"))
		"declaredActor":
			return _one_of(s, _decl(ctx, "actor"))
		"declaredTarget":
			return _one_of(s, _decl(ctx, "target"))
		"adjacent":
			var u = MqBoard.unit(s, ctx.source)
			return MqBoard.adjacent_units(s, u) if u != null else []
		"targetAdjacent":
			var u = MqBoard.unit(s, ctx.get("target"))
			return MqBoard.adjacent_units(s, u) if u != null else []
		"allEnemies":
			return side_units(s, "enemy", ctx, "character")
		"enemyUnits":
			return side_units(s, "enemy", ctx, "unit")
		"friendlyUnits":
			return side_units(s, "friendly", ctx, "unit")
		"otherFriendlyUnits":
			return side_units(s, "friendly", ctx, "unit").filter(func(u): return u.uid != ctx.source)
		"allFriendly":
			return side_units(s, "friendly", ctx, "character")
		"allUnits":
			return side_units(s, "both", ctx, "unit")
		"allCharacters":
			return side_units(s, "both", ctx, "character")
		"randomEnemy":
			return pick_random(s, visible(ctx, side_units(s, "enemy", ctx, "character")), 1)
		"randomEnemyUnit":
			return pick_random(s, visible(ctx, side_units(s, "enemy", ctx, "unit")), 1)
		"randomFriendlyUnit":
			return pick_random(s, side_units(s, "friendly", ctx, "unit"), 1)
		"enemyFront":
			return side_units(s, "enemy", ctx, "unit").filter(func(u): return u.row == "front")
		"enemyBack":
			return side_units(s, "enemy", ctx, "unit").filter(func(u): return u.row == "back")
		"friendlyFront":
			return side_units(s, "friendly", ctx, "unit").filter(func(u): return u.row == "front")
		"friendlyBack":
			return side_units(s, "friendly", ctx, "unit").filter(func(u): return u.row == "back")
	return []

static func pick_random(s: Dictionary, list: Array, n: int) -> Array:
	if list.size() <= n:
		return list
	return MqU.js_slice(MqRng.shuffle(s.rng, list.duplicate()), 0, n)

static func select_query(s: Dictionary, q: Dictionary, ctx: Dictionary) -> Array:
	var list = side_units(s, q.side, ctx, MqU.nz(q.get("kind"), "unit"))
	if q.side != "friendly":
		list = visible(ctx, list)
	if MqU.truthy(q.get("row")):
		list = list.filter(func(u): return u.row == q.row)
	if MqU.truthy(q.get("notSelf")):
		list = list.filter(func(u): return u.uid != ctx.source)
	if q.get("where") != null:
		var kept = []
		for u in list:
			var c2: Dictionary = ctx.duplicate(false)
			c2.it = u.uid
			if eval_cond(s, q.where, c2):
				kept.append(u)
		list = kept
	var n = MqU.nz(q.get("n"), 1)
	match MqU.nz(q.get("pick"), "all"):
		"all":
			return list
		"random":
			return pick_random(s, list, n)
		"first":
			return MqU.js_slice(list, 0, n)
		"lowestHp":
			return MqU.js_slice(MqU.stable_sort(list, func(a, b): return MqU.cmp_or(a.hp - b.hp, a.ts - b.ts)), 0, n)
		"highestHp":
			return MqU.js_slice(MqU.stable_sort(list, func(a, b): return MqU.cmp_or(b.hp - a.hp, a.ts - b.ts)), 0, n)
		"highestAtk":
			return MqU.js_slice(MqU.stable_sort(list, func(a, b): return MqU.cmp_or(MqBoard.atk_of(s, b) - MqBoard.atk_of(s, a), a.ts - b.ts)), 0, n)
		"lowestAtk":
			return MqU.js_slice(MqU.stable_sort(list, func(a, b): return MqU.cmp_or(MqBoard.atk_of(s, a) - MqBoard.atk_of(s, b), a.ts - b.ts)), 0, n)
	return list

static func eval_cond(s: Dictionary, c: Dictionary, ctx: Dictionary) -> bool:
	if c.has("gt"):
		return eval_value(s, c.gt[0], ctx) > eval_value(s, c.gt[1], ctx)
	if c.has("lt"):
		return eval_value(s, c.lt[0], ctx) < eval_value(s, c.lt[1], ctx)
	if c.has("gte"):
		return eval_value(s, c.gte[0], ctx) >= eval_value(s, c.gte[1], ctx)
	if c.has("lte"):
		return eval_value(s, c.lte[0], ctx) <= eval_value(s, c.lte[1], ctx)
	if c.has("eq"):
		return eval_value(s, c.eq[0], ctx) == eval_value(s, c.eq[1], ctx)
	if c.has("and"):
		for x in c["and"]:
			if not eval_cond(s, x, ctx):
				return false
		return true
	if c.has("or"):
		for x in c["or"]:
			if eval_cond(s, x, ctx):
				return true
		return false
	if c.has("not"):
		return not eval_cond(s, c["not"], ctx)
	if c.has("hasStatus"):
		for u in select(s, c.hasStatus.of, ctx):
			if u.statuses.get(c.hasStatus.status, 0) > 0:
				return true
		return false
	if c.has("hasKeyword"):
		for u in select(s, c.hasKeyword.of, ctx):
			if MqBoard.has_kw(s, u, c.hasKeyword.keyword):
				return true
		return false
	if c.has("isUnit"):
		for u in select(s, c.isUnit, ctx):
			if u.kind == "unit":
				return true
		return false
	if c.has("isCommander"):
		for u in select(s, c.isCommander, ctx):
			if u.kind == "commander":
				return true
		return false
	if c.has("alive"):
		return select(s, c.alive, ctx).size() > 0
	if c.has("inRow"):
		for u in select(s, c.inRow.of, ctx):
			if u.row == c.inRow.row:
				return true
		return false
	if c.has("combo"):
		return s.cardsPlayedThisTurn >= c.combo
	if c.has("resonance"):
		var n = 0
		for x in s.sources:
			if x.get("temp") != true and x.color == c.resonance.color:
				n += 1
		return n >= c.resonance.n
	if c.has("suit"):
		var j = ctx.get("judge")
		if j == null:
			return false
		if c.suit == "yang":
			return MqDefs.YANG.has(j.suit)
		if c.suit == "yin":
			return not MqDefs.YANG.has(j.suit)
		return j.suit == c.suit
	if c.has("rank"):
		var r = ctx.judge.rank if ctx.get("judge") != null else 0
		var mn = c.rank.get("min")
		var mx = c.rank.get("max")
		return (mn == null or r >= mn) and (mx == null or r <= mx)
	if c.has("chance"):
		return MqRng.rand(s.rng) < c.chance
	if c.has("inWindow"):
		return (ctx.get("inWindow") == true) == c.inWindow
	if c.has("declared"):
		var actor = MqBoard.unit(s, _decl(ctx, "actor"))
		if actor == null or actor.origin != "enemy" or actor.get("intent") == null:
			return false
		var mv = MqContent.enemy(actor.def).moves.get(actor.intent.move)
		return mv != null and mv.intent.has(c.declared)
	if c.has("myTurn"):
		return (s.active == ctx.side) == c.myTurn
	if c.has("eventCard"):
		var card = _ev(ctx, "card")
		if card == null:
			return false
		return MqContent.match_card(MqContent.card(card.id, card.up), c.eventCard)
	if c.has("hasEquip"):
		return s.sides[ctx.side].equip.get(c.hasEquip) != null
	if c.has("emptySlot"):
		var sd: Dictionary = s.sides[ctx.side if c.emptySlot.side == "friendly" else MqState.other(ctx.side)]
		var rows: Array = [c.emptySlot.row] if MqU.truthy(c.emptySlot.get("row")) else ["front", "back"]
		for r in rows:
			for id in sd[r]:
				if not MqBoard.alive(MqBoard.unit(s, id)):
					return true
		return false
	return false
