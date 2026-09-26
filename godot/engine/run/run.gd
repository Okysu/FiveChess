## Port of src/engine/run/run.ts — run (adventure) layer: map traversal, node screens, rewards, shop, camp, events,
## recruit, stargazing. Pure & deterministic: every random choice derives from the run seed + a label.
## RunState / Screen / RunAction are Dictionaries with the TS field names (see run.ts).
class_name MqRun
extends RefCounted

const HIDDEN_BOSS := "enc4_nameless"
static var _re_random_enc: RegEx

static func rng_for(r: Dictionary, label: String) -> Array:
	return MqRng.seed_rng(String(r.seed) + "/" + label)

static func full_fate_deck() -> Array:
	var out = []
	for suit in MqDefs.SUITS:
		for i in 13:
			out.append({"suit": suit, "rank": i + 1})
	return out

## o: {seed, commander, ascension, tutorial?, locked?, unlockedHidden?}
static func new_run(o: Dictionary) -> Dictionary:
	var cmd = MqContent.commander(o.commander)
	var max_hp = cmd.hp
	if o.ascension >= 6:
		max_hp = MqU.js_round(max_hp * 0.9)
	var r = {
		"v": 1, "seed": o.seed, "ascension": o.ascension, "tutorial": o.get("tutorial") == true, "commander": cmd.id, "lieutenant": null,
		"hp": max_hp, "maxHp": max_hp, "gold": 99, "deck": [], "relics": [{"id": cmd.relic, "counter": 0}], "potions": [null, null, null],
		"fateDeck": full_fate_deck(), "act": 1, "floor": 0, "map": {"act": 1, "rows": [], "boss": null, "width": 7, "height": 15}, "pos": null, "bosses": {},
		"screen": {"k": "actStart", "act": 1}, "stack": [], "pending": [], "flags": [], "emberCapBonus": 0, "extraStartSources": [],
		"seenEvents": [], "seenRelics": [cmd.relic], "relicBags": {}, "previews": {}, "rarityOffset": -5, "potionChance": 40, "nextUid": 1,
		"locked": o.locked if o.get("locked") != null else {}, "unlockedHidden": o.get("unlockedHidden") == true,
		"stats": {"floors": 0, "combats": 0, "elites": 0, "bosses": 0, "goldEarned": 0, "damageTaken": 0, "cardsPlayed": 0, "turns": 0, "maxDamage": 0},
		"history": [], "discovered": {"cards": [], "enemies": [], "relics": [cmd.relic]}, "log": [], "result": null,
	}
	for id in cmd.deck:
		add_card_to_deck(r, id, false)
	if o.ascension >= 10 and MqContent.cards.has("cu_suye"):
		add_card_to_deck(r, "cu_suye", false)
	if o.ascension >= 13:
		for i in 4:
			r.fateDeck.append({"suit": "thunder", "rank": 13, "omen": true})
	var rel = MqContent.relic(cmd.relic)
	if rel.get("onPickup") != null:
		r.pending.append_array(rel.onPickup)
	# choose the act bosses up-front
	for act in [1, 2, 3, 4]:
		var boss_encs = []
		for id in MqContent.encounters:
			var e: Dictionary = MqContent.encounters[id]
			if e.act != act or e.tier != "boss":
				continue
			if act == 4:
				var skip = false
				for x in e.enemies:
					if String(x.id).contains("nameless") or String(x.id).contains("wuming"):
						skip = true
				if skip:
					continue
			boss_encs.append(e)
		boss_encs = MqU.stable_sort(boss_encs, func(a, b): return MqContent.locale_compare(a.id, b.id))
		var b = MqRng.pick(rng_for(r, "boss:%d" % act), boss_encs)
		if b != null:
			r.bosses[act] = b.id
	start_act(r, 1)
	return r

static func start_act(r: Dictionary, act: int) -> void:
	r.act = act
	r.pos = null
	r.map = MqMap.generate_map("%s/map:%d" % [r.seed, act], {"act": act, "hasLieutenant": MqU.truthy(r.lieutenant), "tutorial": r.tutorial, "ascension": r.ascension})
	r.map.boss = r.bosses.get(act)
	r.screen = {"k": "actStart", "act": act}
	if not has_rule(r, "mapReveal").is_empty():
		preview_nodes(r, 99)

static func own_colors(r: Dictionary) -> Array:
	var out: Array = [MqContent.commander(r.commander).faction]
	if MqU.truthy(r.lieutenant):
		var l = MqContent.lieutenants.get(r.lieutenant)
		if l != null:
			out.append(l.faction)
	return out

static func add_card_to_deck(r: Dictionary, id: String, up: bool) -> Dictionary:
	var ref = {"uid": r.nextUid, "id": id, "up": up}
	r.nextUid += 1
	r.deck.append(ref)
	if not r.discovered.cards.has(id):
		r.discovered.cards.append(id)
	return ref

static func has_rule(r: Dictionary, rule: String) -> Array:
	var out = []
	for rs in r.relics:
		var d = MqContent.relics.get(rs.id)
		if d == null or d.get("run") == null:
			continue
		for rr in d.run:
			if rr.rule == rule:
				out.append(rr)
	return out

static func _sum_rule(r: Dictionary, rule: String, key: String):
	var t = 0
	for x in has_rule(r, rule):
		t += MqU.nz(x.get(key), 0)
	return t

# ───────────── combat hand-off ─────────────

static func combat_config(r: Dictionary) -> Dictionary:
	var sc: Dictionary = r.screen
	if sc.k != "combat":
		MqCore.fail("not in combat")
		return {}
	var deck = []
	for d in r.deck:
		deck.append({"id": d.id, "up": d.up})
	var relics = []
	for x in r.relics:
		relics.append(x.duplicate(false))
	var fate = []
	for f in r.fateDeck:
		fate.append(f.duplicate(false))
	return {
		"commander": r.commander, "lieutenant": r.lieutenant, "hp": r.hp, "maxHp": r.maxHp,
		"deck": deck, "relics": relics, "potions": r.potions.duplicate(),
		"fateDeck": fate, "encounter": sc.encounter, "ascension": r.ascension, "seed": sc.seed,
		"emberCapBonus": r.emberCapBonus, "extraStartSources": r.extraStartSources.duplicate(),
	}

static func enter_combat(r: Dictionary, encounter: String, tier: String, reward: String) -> void:
	var enc = MqContent.encounters.get(encounter)
	var tut = null
	if r.tutorial and enc != null:
		tut = enc.get("tutorial")
	r.screen = {"k": "combat", "encounter": encounter, "tier": tier, "seed": "%s/combat:%d:%d:%s" % [r.seed, r.act, r.floor, encounter], "reward": reward, "tutorial": tut}

static func _enc_list() -> Array:
	var out = []
	for id in MqContent.encounters:
		out.append(MqContent.encounters[id])
	return out

static func _by_locale(list: Array) -> Array:
	return MqU.stable_sort(list, func(a, b): return MqContent.locale_compare(a.id, b.id))

static func pick_event_encounter(r: Dictionary, rng: Array, tier: String) -> String:
	var act = mini(r.act, 3)
	var pool = []
	for e in _enc_list():
		if e.act == act and e.tier == tier and MqU.nz(e.get("weight"), 1) > 0 and (tier == "elite" or e.get("pool") != "easy"):
			pool.append(e)
	pool = _by_locale(pool)
	var p = MqRng.pick(rng, pool)
	if p != null:
		return p.id
	var alt = []
	for e in _enc_list():
		if e.act == act and e.tier == "normal" and MqU.nz(e.get("weight"), 1) > 0:
			alt.append(e)
	return MqRng.pick(rng, alt).id

static func pick_encounter(r: Dictionary, node: Dictionary, tier: String) -> String:
	var key = "%d:%d:%d" % [r.act, node.row, node.col]
	if MqU.truthy(r.previews.get(key)):
		return r.previews[key]
	var all = []
	for e in _enc_list():
		if e.act == r.act and e.tier == tier and MqU.nz(e.get("weight"), 1) > 0:
			all.append(e)
	all = _by_locale(all)
	var pool = all
	if tier == "normal":
		var combats_this_act = 0
		for h in r.history:
			if h.act == r.act and h.type == "combat":
				combats_this_act += 1
		var easy = all.filter(func(e): return e.get("pool") == "easy")
		var hard = all.filter(func(e): return e.get("pool") != "easy")
		pool = easy if combats_this_act < 3 and not easy.is_empty() else (hard if not hard.is_empty() else all)
	if tier == "elite" and r.tutorial and r.act == 1:
		var tut = pool.filter(func(e): return e.get("tutorial") == "response")
		if not tut.is_empty() and not r.flags.has("tut_response"):
			pool = tut
	var recent = []
	for h in MqU.js_slice(r.history, -3):
		recent.append(h.detail)
	var fresh = pool.filter(func(e): return not recent.has(e.id))
	return MqRng.pick(rng_for(r, "enc:" + key), fresh if not fresh.is_empty() else pool).id

static func apply_combat_result(r: Dictionary, a: Dictionary) -> void:
	var sc: Dictionary = r.screen
	if sc.k != "combat":
		return
	r.stats.damageTaken += max(0, r.hp - a.hp)
	r.stats.cardsPlayed += a.stats.cardsPlayed
	r.stats.turns += a.stats.turns
	r.stats.maxDamage = max(r.stats.maxDamage, a.stats.damageDealt)
	r.hp = max(0, a.hp)
	r.potions = a.potions.duplicate()
	var rel = []
	for x in a.relics:
		rel.append(x.duplicate(false))
	r.relics = rel
	for e in a.enemies:
		if not r.discovered.enemies.has(e):
			r.discovered.enemies.append(e)
	if a.result == "lose" or r.hp <= 0:
		# the hidden boss is an optional epilogue after a completed run: falling there still counts as a win
		if r.flags.has("hidden_boss"):
			r.hp = max(1, r.hp)
			r.flags.append("hidden_boss_lost")
			r.result = "win"
			r.screen = {"k": "victory"}
			return
		r.result = "lose"
		r.nemesis = sc.encounter
		r.screen = {"k": "defeat"}
		return
	r.stats.combats += 1
	if sc.tier == "elite":
		r.stats.elites += 1
	if sc.get("tutorial") == "response":
		r.flags.append("tut_response")
	var gold = a.gold
	var items = []
	var rng = rng_for(r, "reward:%d:%d" % [r.act, r.floor])
	if sc.reward != "none":
		var base: int
		if sc.reward == "boss":
			base = MqRng.rand_int(rng, 95, 105)
		elif sc.reward == "elite":
			base = MqRng.rand_int(rng, 25, 35)
		else:
			base = MqRng.rand_int(rng, 10, 20)
		gold += base
	var bonus = _sum_rule(r, "goldBonus", "pct")
	gold = MqU.js_round(gold * (1 + MqU.fdiv(bonus, 100)))
	if gold > 0:
		items.append({"k": "gold", "n": gold})
	if sc.reward != "none":
		items.append({"k": "cards", "options": roll_card_reward(r, rng, sc.reward)})
		if sc.reward == "elite":
			items.append({"k": "relic", "id": roll_relic(r, rng, roll_relic_tier(rng))})
			if not has_rule(r, "eliteRelicExtra").is_empty():
				items.append({"k": "relic", "id": roll_relic(r, rng, roll_relic_tier(rng))})
		if MqRng.rand_int(rng, 1, 100) <= r.potionChance:
			var p = roll_potion(r, rng)
			if p != null:
				items.append({"k": "potion", "id": p})
			r.potionChance = max(10, r.potionChance - 10)
		else:
			r.potionChance = min(90, r.potionChance + 10)
	if sc.reward == "boss":
		r.stats.bosses += 1
		var opts = []
		for i in 3:
			opts.append(roll_relic(r, rng, "boss"))
		var uniq = []
		for i in opts.size():
			if opts.find(opts[i]) == i:
				uniq.append(opts[i])
		r.stack.append({"k": "bossRelic", "options": uniq})
	r.screen = {"k": "reward", "items": items, "elite": sc.reward == "elite"}

# ───────────── rolls ─────────────

static func rarity_for(rng: Array, kind: String, offset) -> String:
	if kind == "boss":
		return "legendary" if MqRng.rand(rng) < 0.3 else "epic"
	var roll = MqRng.rand_int(rng, 1, 100) + offset
	var t: Dictionary
	if kind == "elite":
		t = {"legendary": 97, "epic": 83, "rare": 45}
	elif kind == "shop":
		t = {"legendary": 97, "epic": 88, "rare": 55}
	else:
		t = {"legendary": 99, "epic": 92, "rare": 62}
	if roll >= t.legendary:
		return "legendary"
	if roll >= t.epic:
		return "epic"
	if roll >= t.rare:
		return "rare"
	return "common"

static func card_pool(r: Dictionary, filter: Dictionary = {}) -> Array:
	var locked = {}
	for id in MqU.nz(r.locked.get("cards"), []):
		locked[id] = true
	var tutorial_no_advanced: bool = r.tutorial and r.act == 1 and not r.flags.has("tut_response")
	var out = []
	for c in MqContent.filter_cards(filter, own_colors(r)):
		if locked.has(c.id):
			continue
		if tutorial_no_advanced:
			var kws = c.get("keywords")
			if c.type == "response" or c.type == "delay" or (kws != null and kws.has("judge")):
				continue
		out.append(c)
	return out

static func _not_in(pool: Array, out: Array) -> Array:
	var res = []
	for c in pool:
		var dup = false
		for o in out:
			if o.id == c.id:
				dup = true
				break
		if not dup:
			res.append(c)
	return res

static func roll_card_reward(r: Dictionary, rng: Array, kind: String, n := 3) -> Array:
	var extra = _sum_rule(r, "extraCardChoice", "n")
	var own = own_colors(r)
	var out = []
	var up_chance = 1 if not has_rule(r, "upgradeRewards").is_empty() else (r.act - 1) * 0.15 * (0.5 if r.ascension >= 12 else 1)
	var i = 0
	while i < n + extra:
		i += 1
		var rarity = rarity_for(rng, kind, r.rarityOffset)
		if rarity == "common":
			r.rarityOffset = min(40, r.rarityOffset + 1)
		elif rarity != "rare":
			r.rarityOffset = -5
		var fr = MqRng.rand(rng)
		var faction
		if MqU.truthy(r.lieutenant):
			faction = own[0] if fr < 0.55 else (MqU.at(own, 1) if fr < 0.87 else "N")
		else:
			faction = own[0] if fr < 0.85 else "N"
		var pool = _not_in(card_pool(r, {"faction": faction, "rarity": rarity}), out)
		if pool.is_empty():
			pool = _not_in(card_pool(r, {"faction": "own", "rarity": rarity}), out)
		if pool.is_empty():
			pool = _not_in(card_pool(r, {}), out)
		var d = MqRng.pick(rng, pool)
		if d != null:
			var up = false
			if d.get("upgrade") != null:
				up = MqRng.rand(rng) < up_chance
			out.append({"uid": r.nextUid, "id": d.id, "up": up})
			r.nextUid += 1
	return out

static func roll_relic_tier(rng: Array) -> String:
	var x = MqRng.rand_int(rng, 1, 100)
	if x <= 50:
		return "common"
	if x <= 83:
		return "uncommon"
	return "rare"

static func _relic_eligible(r: Dictionary, x: Dictionary, tier: String, own: Array, locked: Dictionary) -> bool:
	if x.tier != tier or locked.has(x.id):
		return false
	for h in r.relics:
		if h.id == x.id:
			return false
	var f = x.get("faction")
	return not MqU.truthy(f) or f == "N" or own.has(f)

static func roll_relic(r: Dictionary, rng: Array, tier: String) -> String:
	var own = own_colors(r)
	var locked = {}
	for id in MqU.nz(r.locked.get("relics"), []):
		locked[id] = true
	var bag = r.relicBags.get(tier)
	var any_ok = false
	if bag != null:
		for id in bag:
			if _relic_eligible(r, MqContent.relic(id), tier, own, locked):
				any_ok = true
				break
	if bag == null or not any_ok:
		var ids = []
		for id in MqContent.relics:
			if _relic_eligible(r, MqContent.relics[id], tier, own, locked):
				ids.append(id)
		MqU.default_sort(ids)
		bag = MqRng.shuffle(rng, ids)
		r.relicBags[tier] = bag
	while not bag.is_empty():
		var id = bag.pop_front()
		if _relic_eligible(r, MqContent.relic(id), tier, own, locked):
			return id
	var fallback = []
	for id in MqContent.relics:
		var x: Dictionary = MqContent.relics[id]
		if x.tier != "common":
			continue
		var held = false
		for h in r.relics:
			if h.id == x.id:
				held = true
				break
		if not held:
			fallback.append(x)
	var p = MqRng.pick(rng, fallback)
	return p.id if p != null else MqContent.relic(r.relics[0].id).id

const _POTION_W := {"common": 65, "uncommon": 25, "rare": 10}

static func roll_potion(r: Dictionary, rng: Array):
	var all = []
	for id in MqContent.potions:
		all.append(MqContent.potions[id])
	all = _by_locale(all)
	var p = MqRng.weighted_pick(rng, all, func(x): return _POTION_W[x.rarity])
	return p.id if p != null else null

# ───────────── relic gain ─────────────

static func gain_relic(r: Dictionary, id: String) -> void:
	for x in r.relics:
		if x.id == id:
			return
	r.relics.append({"id": id, "counter": 0})
	if not r.seenRelics.has(id):
		r.seenRelics.append(id)
	if not r.discovered.relics.has(id):
		r.discovered.relics.append(id)
	var d = MqContent.relic(id)
	var run_rules: Array = MqU.nz(d.get("run"), [])
	for rule in run_rules:
		if rule.rule == "potionSlots":
			for i in rule.n:
				r.potions.append(null)
	var reveal = false
	for x in run_rules:
		if x.rule == "mapReveal":
			reveal = true
	if reveal and r.map != null:
		preview_nodes(r, 99)
	if d.get("onPickup") != null:
		r.pending.append_array(d.onPickup)

static func gain_potion(r: Dictionary, id: String) -> bool:
	var i: int = r.potions.find(null)
	if i < 0:
		return false
	r.potions[i] = id
	return true

# ───────────── run effects (events, relic pickups) ─────────────

static func check_cond(r: Dictionary, c: Dictionary) -> bool:
	if c.has("gold"):
		return r.gold >= c.gold
	if c.has("hpAbove"):
		return r.hp > c.hpAbove
	if c.has("commander"):
		return r.commander == c.commander
	if c.has("lieutenant"):
		return r.lieutenant == c.lieutenant
	if c.has("faction"):
		return own_colors(r).has(c.faction)
	if c.has("hasRelic"):
		for x in r.relics:
			if x.id == c.hasRelic:
				return true
		return false
	if c.has("flag"):
		return r.flags.has(c.flag)
	if c.has("act"):
		return r.act == c.act
	if c.has("deckHas"):
		var own = own_colors(r)
		for d in r.deck:
			if MqContent.match_card(MqContent.card(d.id), c.deckHas, own):
				return true
		return false
	if c.has("noLieutenant"):
		return not MqU.truthy(r.lieutenant)
	return true

## process queued run effects until one needs a player choice
static func drain_pending(r: Dictionary) -> void:
	var guard = 0
	while guard < 100 and not r.pending.is_empty():
		guard += 1
		var e: Dictionary = r.pending.pop_front()
		if apply_run_effect(r, e):
			return

static func apply_run_effect(r: Dictionary, e: Dictionary) -> bool:
	var rng = rng_for(r, "fx:%d:%d:%d" % [r.floor, r.log.size(), r.pending.size()])
	match e.op:
		"gold":
			r.gold = max(0, r.gold + e.n)
			if e.n > 0:
				r.stats.goldEarned += e.n
			return false
		"hp":
			r.hp = max(1, min(r.maxHp, r.hp + e.n))
			return false
		"hpPct":
			r.hp = max(1, min(r.maxHp, r.hp + MqU.js_round(MqU.fdiv(r.maxHp * e.pct, 100))))
			return false
		"maxHp":
			r.maxHp = max(1, r.maxHp + e.n)
			r.hp = max(1, min(r.maxHp, r.hp + max(0, e.n)))
			return false
		"addCard":
			var n = MqU.nz(e.get("n"), 1)
			if MqU.truthy(e.get("card")):
				for i in n:
					add_card_to_deck(r, e.card, e.get("upgraded") == true)
				return false
			var pool: Array
			var pf = e.get("pool")
			if pf != null:
				if pf.get("type") == "curse" or pf.get("type") == "status":
					pool = []
					var own = own_colors(r)
					for id in MqContent.cards:
						if MqContent.match_card(MqContent.cards[id], pf, own):
							pool.append(MqContent.cards[id])
				else:
					pool = card_pool(r, pf)
			else:
				pool = card_pool(r)
			if MqU.truthy(e.get("choose")):
				var opts = []
				for d in MqRng.sample(rng, pool, e.choose):
					opts.append({"uid": r.nextUid, "id": d.id, "up": e.get("upgraded") == true})
					r.nextUid += 1
				if not opts.is_empty():
					push_screen(r, {"k": "cardChoice", "options": opts, "n": n})
					return true
				return false
			for i in n:
				var d = MqRng.pick(rng, pool)
				if d != null:
					add_card_to_deck(r, d.id, e.get("upgraded") == true)
			return false
		"removeCard", "upgradeCard", "transformCard", "duplicateCard":
			var kind: String = {"removeCard": "remove", "upgradeCard": "upgrade", "transformCard": "transform", "duplicateCard": "duplicate"}[e.op]
			var mode = e.mode if e.has("mode") else "choose"
			var filter = e.filter if e.has("filter") else null
			var candidates = pick_candidates(r, kind, filter)
			if candidates.is_empty():
				return false
			if mode == "random":
				for c in MqRng.sample(rng, candidates, e.n):
					apply_pick(r, kind, c.uid, rng)
				return false
			push_screen(r, {"k": "pick", "kind": kind, "n": mini(e.n, candidates.size()), "optional": false, "source": "event", "filter": filter})
			return true
		"addRelic":
			var id
			if MqU.truthy(e.get("relic")):
				id = e.relic
			else:
				id = roll_relic(r, rng, e.tier if MqU.truthy(e.get("tier")) else roll_relic_tier(rng))
			gain_relic(r, id)
			return false
		"loseRelic":
			var cands = []
			for x in r.relics:
				if MqContent.relic(x.id).tier != "starter":
					cands.append(x)
			var x = MqRng.pick(rng, cands)
			if x != null:
				r.relics.remove_at(MqU.idx_same(r.relics, x))
			return false
		"addPotion":
			var p = e.potion if MqU.truthy(e.get("potion")) else roll_potion(r, rng)
			if MqU.truthy(p):
				gain_potion(r, p)
			return false
		"fight":
			r.stack.append({"k": "map"})
			# "random:normal" / "random:elite": a fresh encounter from this act's pool
			if _re_random_enc == null:
				_re_random_enc = RegEx.create_from_string("^random:(normal|elite)$")
			var m = _re_random_enc.search(e.encounter)
			var enc: String = pick_event_encounter(r, rng, m.get_string(1)) if m != null else e.encounter
			var ed = MqContent.encounters.get(enc)
			enter_combat(r, enc, ed.tier if ed != null else "normal", MqU.nz(e.get("reward"), "normal"))
			return true
		"fate":
			return fate_effect(r, rng, e)
		"chance":
			var branch: Array = e.then if MqRng.rand(rng) < e.p else MqU.nz(e.get("else"), [])
			for k in branch.size():
				r.pending.insert(k, branch[k])
			return false
		"lieutenant":
			if MqU.truthy(e.get("id")):
				set_lieutenant(r, e.id)
			else:
				push_screen(r, {"k": "recruit", "options": roll_lieutenants(r), "done": false})
			return not MqU.truthy(e.get("id"))
		"flag":
			if not r.flags.has(e.key):
				r.flags.append(e.key)
			return false
		"emberCap":
			r.emberCapBonus += e.n
			return false
		"startSource":
			r.extraStartSources.append(e.color)
			return false
	return false

static func fate_effect(r: Dictionary, rng: Array, e: Dictionary) -> bool:
	var n = MqU.nz(e.get("n"), 1)
	for k in n:
		var suit = e.get("suit")
		var rank = e.get("rank")
		if e.action == "add":
			var s2 = suit if MqU.truthy(suit) else MqRng.pick(rng, MqDefs.SUITS)
			var r2 = rank if MqU.truthy(rank) else MqRng.rand_int(rng, 1, 13)
			r.fateDeck.append({"suit": s2, "rank": r2})
		elif (e.action == "remove" or e.action == "changeSuit") and not MqU.truthy(suit) and not MqU.truthy(rank):
			push_screen(r, {"k": "stargaze", "done": false, "mode": "remove" if e.action == "remove" else "change"})
			return true
		elif e.action == "remove":
			var cands = []
			for i in r.fateDeck.size():
				var f: Dictionary = r.fateDeck[i]
				if (not MqU.truthy(suit) or f.suit == suit) and (not MqU.truthy(rank) or f.rank == rank):
					cands.append({"f": f, "i": i})
			var x = MqRng.pick(rng, cands)
			if x != null and r.fateDeck.size() > 20:
				r.fateDeck.remove_at(x.i)
		elif e.action == "changeSuit":
			var cands = []
			for f in r.fateDeck:
				if f.suit != suit and f.get("omen") != true:
					cands.append(f)
			var x = MqRng.pick(rng, cands)
			if x != null and MqU.truthy(suit):
				x.suit = suit
		elif e.action == "preview":
			push_screen(r, {"k": "stargaze", "done": true, "preview": preview_nodes(r)})
			return true
	return false

static func push_screen(r: Dictionary, s: Dictionary) -> void:
	r.stack.append(r.screen)
	r.screen = s

static func pop_screen(r: Dictionary) -> void:
	var prev = MqU.pop(r.stack)
	r.screen = prev if prev != null else {"k": "map"}
	drain_pending(r)

static func pick_candidates(r: Dictionary, kind: String, filter = null) -> Array:
	var base = []
	for d in r.deck:
		var c = MqContent.card(d.id)
		if kind == "upgrade":
			if not d.up and c.get("upgrade") != null:
				base.append(d)
		elif kind == "remove" or kind == "transform":
			if c.rarity != "special" or c.type == "curse" or c.type == "status":
				base.append(d)
		else:
			base.append(d)
	if filter == null:
		return base
	var own = own_colors(r)
	return base.filter(func(d): return MqContent.match_card(MqContent.card(d.id), filter, own))

static func apply_pick(r: Dictionary, kind: String, uid, rng: Array) -> void:
	var i = -1
	for k in r.deck.size():
		if r.deck[k].uid == uid:
			i = k
			break
	if i < 0:
		return
	var d: Dictionary = r.deck[i]
	if kind == "remove":
		r.deck.remove_at(i)
	elif kind == "upgrade":
		d.up = true
	elif kind == "duplicate":
		add_card_to_deck(r, d.id, d.up)
	elif kind == "transform":
		var def = MqContent.card(d.id)
		var pool = card_pool(r, {"faction": "own" if def.faction == "N" else def.faction}).filter(func(c): return c.id != d.id)
		var nd = MqRng.pick(rng, pool)
		r.deck.remove_at(i)
		if nd != null:
			add_card_to_deck(r, nd.id, false)

# ───────────── lieutenants ─────────────

static func roll_lieutenants(r: Dictionary) -> Array:
	var own = MqContent.commander(r.commander).faction
	var locked = {}
	for id in MqU.nz(r.locked.get("lieutenants"), []):
		locked[id] = true
	var cands = []
	for id in MqContent.lieutenants:
		var l: Dictionary = MqContent.lieutenants[id]
		if l.faction != own and not locked.has(l.id):
			cands.append(l)
	cands = _by_locale(cands)
	var rng = rng_for(r, "recruit:%d:%d" % [r.act, r.floor])
	# prefer distinct colors
	var out = []
	for l in MqRng.shuffle(rng, cands.duplicate()):
		if out.size() >= 3:
			break
		var dup = false
		for o in out:
			if MqContent.lieutenants[o].faction == l.faction:
				dup = true
				break
		if dup:
			continue
		out.append(l.id)
	for l in cands:
		if out.size() < 3 and not out.has(l.id):
			out.append(l.id)
	return out

static func set_lieutenant(r: Dictionary, id: String) -> void:
	r.lieutenant = id
	r.history.append({"act": r.act, "row": r.pos.row if r.pos != null else -1, "type": "recruit", "detail": id})

# ───────────── stargaze preview ─────────────

static func preview_nodes(r: Dictionary, rows := 3) -> Array:
	var out = []
	var start_row: int = (r.pos.row if r.pos != null else -1) + 1
	for row in r.map.rows:
		for n in row:
			if n.row < start_row or n.row >= start_row + rows:
				continue
			if n.type == "combat" or n.type == "elite":
				var enc = pick_encounter(r, n, "normal" if n.type == "combat" else "elite")
				r.previews["%d:%d:%d" % [r.act, n.row, n.col]] = enc
				var names = []
				var ed = MqContent.encounters.get(enc)
				if ed != null:
					for e in ed.enemies:
						var en = MqContent.enemies.get(e.id)
						names.append(en.name if en != null else e.id)
				out.append({"row": n.row, "col": n.col, "label": "、".join(names)})
			elif n.type == "event":
				var ev = pick_event(r, n)
				if ev != null:
					r.previews["%d:%d:%d" % [r.act, n.row, n.col]] = ev
					var evd = MqContent.events.get(ev)
					out.append({"row": n.row, "col": n.col, "label": evd.title if evd != null else ""})
	return out

static func pick_event(r: Dictionary, n: Dictionary):
	var key = "%d:%d:%d" % [r.act, n.row, n.col]
	if MqU.truthy(r.previews.get(key)):
		return r.previews[key]
	var locked = {}
	for id in MqU.nz(r.locked.get("events"), []):
		locked[id] = true
	var pool = []
	for id in MqContent.events:
		var e: Dictionary = MqContent.events[id]
		if e.acts.has(r.act) and not r.seenEvents.has(e.id) and not locked.has(e.id) and (e.get("requires") == null or check_cond(r, e.requires)):
			pool.append(e)
	pool = _by_locale(pool)
	# commander-specific events are weighted up
	var ev = MqRng.weighted_pick(rng_for(r, "event:" + key), pool, func(e): return 4 if e.get("requires") != null and e.requires.has("commander") else 1)
	return ev.id if ev != null else null

# ───────────── shop ─────────────

const _CARD_PRICE := {"basic": 30, "common": 50, "rare": 75, "epic": 140, "legendary": 220, "token": 30, "special": 60}
const _RELIC_PRICE := {"starter": 100, "common": 150, "uncommon": 240, "rare": 300, "boss": 400, "shop": 180, "event": 200}
const _POTION_PRICE := {"common": 50, "uncommon": 75, "rare": 100}

static func make_shop(r: Dictionary) -> Dictionary:
	var rng = rng_for(r, "shop:%d:%d" % [r.act, r.floor])
	var disc = _sum_rule(r, "shopDiscount", "pct")
	var asc = 1.1 if r.ascension >= 9 else 1
	var price = func(base): return MqU.js_round(base * asc * (1 - MqU.fdiv(disc, 100)) * (0.9 + MqRng.rand(rng) * 0.2))
	var cards = []
	var class_cards = []
	for c in roll_card_reward(r, rng, "normal", 5):
		var c2: Dictionary = c.duplicate(false)
		c2.up = false
		class_cards.append(c2)
	var neutral = []
	for d in MqRng.sample(rng, card_pool(r, {"faction": "N"}), 2):
		neutral.append({"uid": r.nextUid, "id": d.id, "up": false})
		r.nextUid += 1
	for c in class_cards + neutral:
		cards.append({"card": c, "price": price.call(_CARD_PRICE[MqContent.card(c.id).rarity])})
	var sale = MqRng.rand_int(rng, 0, maxi(0, class_cards.size() - 1))
	if MqU.at(cards, sale) != null:
		cards[sale].price = MqU.js_round(MqU.fdiv(cards[sale].price, 2))
	var tiers = [roll_relic_tier(rng), roll_relic_tier(rng), "shop"]
	var relics0 = []
	for t in tiers:
		var id = roll_relic(r, rng, t)
		relics0.append({"id": id, "price": price.call(_RELIC_PRICE[MqContent.relic(id).tier])})
	var relics = []
	for i in relics0.size():
		var first = -1
		for j in relics0.size():
			if relics0[j].id == relics0[i].id:
				first = j
				break
		if first == i:
			relics.append(relics0[i])
	var pids = []
	for i in 3:
		pids.append(roll_potion(r, rng))
	var potions = []
	for id in pids:
		if MqU.truthy(id):
			potions.append({"id": id, "price": price.call(_POTION_PRICE[MqContent.potions[id].rarity])})
	var remove_disc = _sum_rule(r, "removeCostDiscount", "pct")
	var removes = 0
	for f in r.flags:
		if f == "removed":
			removes += 1
	return {"cards": cards, "relics": relics, "potions": potions, "removePrice": MqU.js_round((75 + 25 * removes) * (1 - MqU.fdiv(remove_disc, 100)))}

# ───────────── node entry ─────────────

static func enter_node(r: Dictionary, n: Dictionary) -> void:
	r.pos = {"row": n.row, "col": n.col}
	r.floor += 1
	r.stats.floors += 1
	var detail = []
	match n.type:
		"combat":
			var e = pick_encounter(r, n, "normal")
			detail.append(e)
			enter_combat(r, e, "normal", "normal")
		"elite":
			var e = pick_encounter(r, n, "elite")
			detail.append(e)
			enter_combat(r, e, "elite", "elite")
		"boss":
			var e: String = r.bosses[r.act]
			detail.append(e)
			enter_combat(r, e, "boss", "boss")
		"event":
			var ev = pick_event(r, n)
			if ev == null:
				var e = pick_encounter(r, n, "normal")
				enter_combat(r, e, "normal", "normal")
			else:
				r.seenEvents.append(ev)
				detail.append(ev)
				r.screen = {"k": "event", "id": ev, "page": null}
		"shop":
			r.screen = {"k": "shop", "shop": make_shop(r)}
		"camp":
			r.screen = {"k": "camp", "done": false}
		"chest":
			var rng = rng_for(r, "chest:%d:%d" % [r.act, r.floor])
			var relic = roll_relic(r, rng, roll_relic_tier(rng))
			r.screen = {"k": "chest", "relic": relic, "gold": MqRng.rand_int(rng, 25, 60), "opened": false}
		"recruit":
			if MqU.truthy(r.lieutenant):
				r.screen = {"k": "recruit", "options": [], "done": false}
			else:
				r.screen = {"k": "recruit", "options": roll_lieutenants(r), "done": false}
		"stargaze":
			r.screen = {"k": "stargaze", "done": false}
	r.history.append({"act": r.act, "row": n.row, "col": n.col, "type": n.type, "detail": ",".join(detail)})

## after the last row, the boss node
static func boss_node(r: Dictionary) -> Dictionary:
	return {"row": 2 if r.act == 4 else 15, "col": 3, "type": "boss", "next": [], "x": 0.5, "y": 0}

static func available_nodes(r: Dictionary) -> Array:
	if r.screen.k != "map":
		return []
	if r.act != 4 and r.pos != null and r.pos.row == r.map.rows.size() - 1:
		return [boss_node(r)]
	return MqMap.reachable(r.map, r.pos)

# ───────────── actions ─────────────

static func run_act(r: Dictionary, a: Dictionary):
	var err = apply_run(r, a)
	if err == null:
		r.log.append(a)
		drain_pending(r)
	return err

static func leave_to_map(r: Dictionary) -> void:
	if not r.stack.is_empty():
		pop_screen(r)
		return
	r.screen = {"k": "map"}

static func apply_run(r: Dictionary, a: Dictionary):
	var sc: Dictionary = r.screen
	match a.t:
		"go":
			if sc.k == "actStart":
				r.screen = {"k": "map"}
			if r.screen.k != "map":
				return "not on map"
			var n = null
			for x in available_nodes(r):
				if x.row == a.row and x.col == a.col:
					n = x
					break
			if n == null:
				return "unreachable"
			if n.type == "boss":
				r.pos = {"row": n.row, "col": n.col}
				r.floor += 1
				enter_combat(r, r.bosses[r.act], "boss", "boss")
				r.history.append({"act": r.act, "row": n.row, "col": n.col, "type": "boss", "detail": r.bosses[r.act]})
				return null
			enter_node(r, n)
			return null
		"combatResult":
			apply_combat_result(r, a)
			return null
		"take":
			if sc.k != "reward":
				return "no reward"
			var it = MqU.at(sc.items, a.i)
			if it == null or it.get("taken") == true:
				return "bad item"
			if it.k == "gold":
				r.gold += it.n
				r.stats.goldEarned += it.n
			if it.k == "relic":
				gain_relic(r, it.id)
			if it.k == "potion":
				if not gain_potion(r, it.id):
					return "potion slots full"
			if it.k == "cards":
				if a.get("choice") == null:
					it.taken = true
					return null
				var c = MqU.at(it.options, a.choice)
				if c == null:
					return "bad choice"
				add_card_to_deck(r, c.id, c.up)
			it.taken = true
			return null
		"proceed":
			if sc.k == "actStart":
				r.screen = {"k": "map"}
				return null
			if sc.k == "reward":
				if r.flags.has("hidden_boss"):
					r.stats.bosses += 1
					r.result = "win"
					r.screen = {"k": "victory"}
					return null
				var boss_pending: bool = not r.stack.is_empty() and r.stack[r.stack.size() - 1].k == "bossRelic"
				if boss_pending:
					r.screen = r.stack.pop_back()
					return null
				if r.act >= 1 and sc.get("items") != null and r.screen.k == "reward" and last_was_boss(r):
					advance_act(r)
					return null
				leave_to_map(r)
				return null
			if sc.k == "bossRelic":
				advance_act(r)
				return null
			if sc.k == "event" and sc.get("outcome") != null:
				leave_to_map(r)
				return null
			if sc.k == "event":
				return "choose an option"
			if sc.k == "pick":
				if not sc.optional:
					return "must pick"
				pop_screen(r)
				return null
			if sc.k == "cardChoice":
				pop_screen(r)
				return null
			leave_to_map(r)
			return null
		"bossRelic":
			if sc.k != "bossRelic":
				return "no boss relic"
			if a.get("i") != null:
				var id = MqU.at(sc.options, a.i)
				if not MqU.truthy(id):
					return "bad"
				gain_relic(r, id)
			advance_act(r)
			return null
		"buy":
			if sc.k != "shop":
				return "not in shop"
			var list: Array = sc.shop.cards if a.what == "card" else (sc.shop.relics if a.what == "relic" else sc.shop.potions)
			var it = MqU.at(list, a.i)
			if it == null or it.get("sold") == true:
				return "sold"
			if r.gold < it.price:
				return "not enough gold"
			if a.what == "potion" and not r.potions.has(null):
				return "potion slots full"
			r.gold -= it.price
			it.sold = true
			if a.what == "card":
				add_card_to_deck(r, it.card.id, it.card.up)
			if a.what == "relic":
				gain_relic(r, it.id)
			if a.what == "potion":
				gain_potion(r, it.id)
			return null
		"removeService":
			if sc.k != "shop" or sc.shop.get("removed") == true:
				return "unavailable"
			if r.gold < sc.shop.removePrice:
				return "not enough gold"
			r.gold -= sc.shop.removePrice
			sc.shop.removed = true
			r.flags.append("removed")
			push_screen(r, {"k": "pick", "kind": "remove", "n": 1, "optional": false, "source": "shop"})
			return null
		"rest":
			if sc.k != "camp" or sc.done:
				return "unavailable"
			if a.opt == "heal":
				if not has_rule(r, "noHealAtRest").is_empty():
					return "cannot heal"
				var bonus = _sum_rule(r, "restHealBonus", "amount")
				r.hp = min(r.maxHp, r.hp + MqU.js_round(r.maxHp * 0.3) + bonus)
				sc.done = true
				return null
			var kind = "upgrade" if a.opt == "upgrade" else "remove"
			if pick_candidates(r, kind).is_empty():
				return "nothing to pick"
			sc.done = true
			push_screen(r, {"k": "pick", "kind": kind, "n": 1, "optional": false, "source": "camp"})
			return null
		"pick":
			if sc.k == "cardChoice":
				var chosen = []
				for u in a.uids:
					for o in sc.options:
						if o.uid == u:
							chosen.append(o)
							break
				if chosen.size() > sc.n:
					return "too many"
				for c in chosen:
					add_card_to_deck(r, c.id, c.up)
				pop_screen(r)
				return null
			if sc.k != "pick":
				return "nothing to pick"
			var cands = pick_candidates(r, sc.kind, sc.get("filter"))
			var uids = []
			for u in a.uids:
				for c in cands:
					if c.uid == u:
						uids.append(u)
						break
			if uids.size() != sc.n:
				return "pick exactly %d" % sc.n
			var rng = rng_for(r, "pick:%d:%d" % [r.floor, r.log.size()])
			for u in uids:
				apply_pick(r, sc.kind, u, rng)
			pop_screen(r)
			return null
		"event":
			if sc.k != "event" or sc.get("outcome") != null:
				return "no event"
			var ev = MqContent.events.get(sc.id)
			if ev == null:
				return "bad event"
			var opts: Array = ev.options
			if MqU.truthy(sc.get("page")):
				opts = []
				for p in MqU.nz(ev.get("pages"), []):
					if p.id == sc.page:
						opts = p.options
						break
			var o = MqU.at(opts, a.i)
			if o == null:
				return "bad option"
			if o.get("requires") != null and not check_cond(r, o.requires):
				return "requirement not met"
			if MqU.truthy(o.get("next")):
				sc.page = o.next
				r.pending.append_array(o.effects)
				return null
			sc.outcome = o.outcome
			r.pending.append_array(o.effects)
			return null
		"recruit":
			if sc.k != "recruit" or sc.done:
				return "no recruit"
			sc.done = true
			if a.get("i") == null:
				if MqU.truthy(r.lieutenant):
					r.gold += 50
				return null
			var id = MqU.at(sc.options, a.i)
			if not MqU.truthy(id):
				return "bad"
			set_lieutenant(r, id)
			return null
		"fate":
			if sc.k != "stargaze" or sc.done:
				return "no stargaze"
			if MqU.truthy(sc.get("mode")) and a.op != sc.mode:
				return "not allowed here"
			if a.op == "preview":
				sc.preview = preview_nodes(r)
				sc.done = true
				return null
			var f = MqU.at(r.fateDeck, a.get("idx") if a.get("idx") != null else -1)
			if f == null:
				return "bad fate card"
			if a.op == "remove":
				if r.fateDeck.size() <= 20:
					return "fate deck too small"
				r.fateDeck.remove_at(a.idx)
			if a.op == "copy":
				var cp: Dictionary = f.duplicate(false)
				cp.erase("omen")
				r.fateDeck.append(cp)
			if a.op == "change":
				if not MqU.truthy(a.get("suit")) or f.get("omen") == true:
					return "bad suit"
				f.suit = a.suit
			sc.done = true
			return null
		"open":
			if sc.k != "chest" or sc.opened:
				return "no chest"
			sc.opened = true
			r.gold += sc.gold
			if MqU.truthy(sc.get("relic")):
				gain_relic(r, sc.relic)
			return null
		"discardPotion":
			if MqU.truthy(MqU.at(r.potions, a.slot)):
				r.potions[a.slot] = null
			return null
		"mapPotion":
			var id = MqU.at(r.potions, a.slot)
			var d = MqContent.potions.get(id) if MqU.truthy(id) else null
			if d == null or d.get("outOfCombat") == null:
				return "not usable here"
			r.potions[a.slot] = null
			r.pending.append_array(d.outOfCombat)
			return null
		"hidden":
			if sc.k != "hiddenChoice":
				return "no choice"
			if not a.go:
				r.result = "win"
				r.screen = {"k": "victory"}
				return null
			var hidden = MqContent.encounters.get(HIDDEN_BOSS)
			if hidden == null:
				for e in _enc_list():
					if e.act == 4 and e.tier == "boss" and e.id != r.bosses.get(4):
						hidden = e
						break
			if hidden == null:
				r.result = "win"
				r.screen = {"k": "victory"}
				return null
			r.flags.append("hidden_boss")
			enter_combat(r, hidden.id, "boss", "none")
			return null
	return "unknown action"

static func last_was_boss(r: Dictionary) -> bool:
	var h = MqU.at(r.history, r.history.size() - 1)
	return h != null and h.type == "boss" and r.screen.k == "reward" and not r.flags.has("bossdone:%d" % r.act)

static func advance_act(r: Dictionary) -> void:
	r.flags.append("bossdone:%d" % r.act)
	if r.act >= 4 or r.flags.has("hidden_boss"):
		if r.act == 4 and r.unlockedHidden and not r.flags.has("hidden_boss"):
			r.screen = {"k": "hiddenChoice"}
			return
		r.result = "win"
		r.screen = {"k": "victory"}
		return
	# heal after boss
	var missing = r.maxHp - r.hp
	r.hp += MqU.js_round(missing * 0.75) if r.ascension >= 5 else missing
	start_act(r, r.act + 1)
