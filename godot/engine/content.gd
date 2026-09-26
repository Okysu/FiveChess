## Port of src/engine/content.ts (+ src/data/index.ts bundleFromModules, scripts/load-content.ts).
## Static content registry. Loads the SAME JSON as the TS engine from res://data (copied by
## scripts/sync-godot-data.ts) in the SAME file order (res://data/_index.json `files`), so Dictionary insertion
## order == TS Map insertion order (filterCards / values() iteration feeds RNG picks).
## Definitions are plain Dictionaries shaped exactly like the TS defs (see defs.gd).
class_name MqContent
extends RefCounted

static var loaded := false
static var cards := {}
static var commanders := {}
static var lieutenants := {}
static var enemies := {}
static var encounters := {}
static var relics := {}
static var potions := {}
static var events := {}
static var _up_cache := {}
## localeCompare emulation: rank of every content id in TS `a.localeCompare(b)` order
static var collate := {}

static func load_all(data_dir := "res://data") -> void:
	if loaded:
		return
	var index = MqU.read_json(data_dir + "/_index.json")
	collate = index.collate
	for rel in index.files:
		var data = MqU.read_json(data_dir + "/" + rel)
		if not (data is Array):
			continue
		var p: String = "/" + String(rel)
		var target: Dictionary
		if p.contains("/cards/"):
			target = cards
		elif p.contains("/enemies/"):
			target = enemies
		elif p.ends_with("/commanders.json"):
			target = commanders
		elif p.ends_with("/lieutenants.json"):
			target = lieutenants
		elif p.contains("/encounters"):
			target = encounters
		elif p.contains("/relics"):
			target = relics
		elif p.ends_with("/potions.json"):
			target = potions
		elif p.contains("/events"):
			target = events
		else:
			continue
		for d in data:
			target[d.id] = d # re-set keeps the first insertion position, like Map.set
	loaded = true

## String.prototype.localeCompare for content ids (falls back to code-point order for unknown strings)
static func locale_compare(a: String, b: String) -> int:
	if collate.has(a) and collate.has(b):
		return int(collate[a]) - int(collate[b])
	return MqU.str_cmp(a, b)

static func card(id: String, up := false) -> Dictionary:
	var base = cards.get(id)
	if base == null:
		push_error("unknown card " + id)
		MqCore.fail("unknown card " + id)
		return {"id": id, "name": id, "faction": "N", "type": "status", "rarity": "special", "cost": {"g": 0}, "text": ""}
	if not up or base.get("upgrade") == null:
		return base
	var hit = _up_cache.get(id)
	if hit != null:
		return hit
	var u: Dictionary = base.upgrade
	var m: Dictionary = base.duplicate(false)
	m.name = u.name if u.get("name") != null else base.name + "+"
	m.text = u.text if u.get("text") != null else base.text
	m.cost = u.cost if u.get("cost") != null else base.cost
	var vars = {}
	if base.get("vars") != null:
		vars.merge(base.vars, true)
	if u.get("vars") != null:
		vars.merge(u.vars, true)
	m.vars = vars
	for k in ["keywords", "effects", "target", "onSacrifice", "inHand", "windowOnly"]:
		var v = u.get(k) if u.get(k) != null else base.get(k)
		if v == null:
			m.erase(k)
		else:
			m[k] = v
	for k in ["unit", "equip", "delay", "field"]:
		if base.get(k) != null:
			var sub: Dictionary = base[k].duplicate(false)
			if u.get(k) != null:
				for kk in u[k]:
					sub[kk] = u[k][kk]
			m[k] = sub
		else:
			m.erase(k)
	_up_cache[id] = m
	return m

static func has_card(id: String) -> bool:
	return cards.has(id)

static func enemy(id: String) -> Dictionary:
	var e = enemies.get(id)
	if e == null:
		MqCore.fail("unknown enemy " + id)
		return {}
	return e

static func commander(id: String) -> Dictionary:
	var c = commanders.get(id)
	if c == null:
		MqCore.fail("unknown commander " + id)
		return {}
	return c

static func relic(id: String) -> Dictionary:
	var r = relics.get(id)
	if r == null:
		MqCore.fail("unknown relic " + id)
		return {}
	return r

## cards matching a filter; `own` faction resolves to the given colors
static func filter_cards(f: Dictionary, own: Array = [], pool_only := true) -> Array:
	var out = []
	for id in cards:
		var c: Dictionary = cards[id]
		if pool_only:
			var r: String = c.rarity
			if c.get("pool") == false or r == "basic" or r == "token" or r == "special":
				continue
			if c.type == "status" or c.type == "curse":
				continue
		if match_card(c, f, own):
			out.append(c)
	return out

static func _as_list(v) -> Array:
	return v if v is Array else [v]

static func match_card(c: Dictionary, f: Dictionary, own: Array = []) -> bool:
	if MqU.truthy(f.get("id")) and c.id != f.id:
		return false
	if MqU.truthy(f.get("type")):
		if not _as_list(f.type).has(c.type):
			return false
	if MqU.truthy(f.get("faction")):
		var fs: Array
		if typeof(f.faction) == TYPE_STRING and f.faction == "own":
			fs = own.duplicate()
			fs.append("N")
		else:
			fs = _as_list(f.faction)
		if not fs.has(c.faction):
			return false
	if MqU.truthy(f.get("rarity")):
		if not _as_list(f.rarity).has(c.rarity):
			return false
	if MqU.truthy(f.get("keyword")):
		var kw = c.get("keywords")
		var ukw = c.unit.get("keywords") if c.get("unit") != null else null
		if not (kw != null and kw.has(f.keyword)) and not (ukw != null and ukw.has(f.keyword)):
			return false
	var cost = 0
	if typeof(c.cost.g) != TYPE_STRING:
		cost = int(c.cost.g) + (c.cost.c.size() if c.cost.get("c") != null else 0)
	if f.get("maxCost") != null and cost > f.maxCost:
		return false
	if f.get("minCost") != null and cost < f.minCost:
		return false
	return true
