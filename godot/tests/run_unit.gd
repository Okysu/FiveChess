## Minimal GDScript unit-test runner (no plugins). Each `test_*` method is run; `check()` records failures.
##   godot --headless --path godot --script res://tests/run_unit.gd
## Expected values were produced by the TS engine (src/engine) — see the comment on each test.
extends SceneTree

var _fails: Array = []
var _checks := 0
var _current := ""

func check(cond: bool, what: String) -> void:
	_checks += 1
	if not cond:
		_fails.append("%s: %s" % [_current, what])

func eq(got, want, what: String) -> void:
	var ok: bool
	if (typeof(got) == TYPE_INT or typeof(got) == TYPE_FLOAT) and (typeof(want) == TYPE_INT or typeof(want) == TYPE_FLOAT):
		ok = float(got) == float(want)
	else:
		ok = MqParity.diff(MqParity.canon(want), MqParity.canon(got)).is_empty()
	check(ok, "%s: got %s, want %s" % [what, JSON.stringify(got), JSON.stringify(want)])

func _init() -> void:
	MqContent.load_all()
	var names = []
	for m in get_method_list():
		if String(m.name).begins_with("test_"):
			names.append(m.name)
	names.sort()
	for n in names:
		_current = n
		call(n)
	for f in _fails:
		printerr("FAIL ", f)
	print("%d tests, %d checks, %d failures" % [names.size(), _checks, _fails.size()])
	quit(0 if _fails.is_empty() else 1)

# seedRng / nextU32 / rand / randInt / shuffle — values printed by src/engine/rng.ts
func test_rng_sequence() -> void:
	var s = MqRng.seed_rng("abc")
	eq(s, [2639997409, 331273608, 3150809668, 1611500309], "seedRng('abc')")
	eq([MqRng.next_u32(s), MqRng.next_u32(s), MqRng.next_u32(s)], [287804030, 234779228, 574189896], "nextU32 x3")
	var s2 = MqRng.seed_rng("命阙/combat:1:2 😀") # non-ASCII + astral plane (UTF-16 surrogates)
	eq(s2, [41936926, 877503130, 2256079505, 3121307555], "seedRng(unicode)")
	eq(MqRng.rand(s2), 0.940809867111966, "rand")
	eq(MqRng.rand_int(s2, 1, 100), 66, "randInt")
	eq(MqRng.shuffle(MqRng.seed_rng("x"), [1, 2, 3, 4, 5, 6, 7, 8]), [8, 3, 6, 5, 7, 2, 4, 1], "shuffle")

func test_imul() -> void:
	# Math.imul(0xffffffff, 5) === -5 ; Math.imul(0x7fffffff, 0x7fffffff) === 1
	eq(MqRng.imul(0xFFFFFFFF, 5), (-5) & 0xFFFFFFFF, "imul(-1,5)")
	eq(MqRng.imul(0x7FFFFFFF, 0x7FFFFFFF), 1, "imul(max,max)")
	eq(MqRng.imul(123456789, 987654321), 4227814277, "imul(123456789, 987654321) >>> 0")

func test_fill_vars() -> void:
	eq(MqGloss.fill_vars("造成{d}点伤害，{x}次{sun}", {"d": 6, "x": 1.5}), "造成6点伤害，1.5次{sun}", "fillVars")
	eq(MqGloss.plain_rules("造成{d}点[灼烧]{sun}{R}", {"d": 7}), "造成7点灼烧", "plainRules")
	eq(MqGloss.fill_vars("无{a}", null), "无{a}", "fillVars without vars")

func test_js_semantics() -> void:
	eq(MqU.js_round(2.5), 3, "Math.round(2.5)")
	eq(MqU.js_round(-2.5), -2, "Math.round(-2.5)")
	eq(MqU.floori(-3.5), -4, "Math.floor(-3.5)")
	eq(MqU.js_slice([1, 2, 3], -0), [1, 2, 3], "slice(-0)")
	eq(MqU.js_slice([1, 2, 3], -2), [2, 3], "slice(-2)")
	eq(MqU.at([1, 2], -1), null, "arr[-1]")
	var pairs = [[1, "a"], [0, "b"], [1, "c"], [0, "d"], [1, "e"]]
	eq(MqU.stable_sort(pairs, func(a, b): return a[0] - b[0]), [[0, "b"], [0, "d"], [1, "a"], [1, "c"], [1, "e"]], "stable sort")
	eq(MqU.json_norm(JSON.parse_string('{"a": 5, "b": 0.5}')), {"a": 5, "b": 0.5}, "json ints")
	check(typeof(MqU.json_norm(JSON.parse_string("[5]"))[0]) == TYPE_INT, "json int type")

func test_card_upgrade_merge() -> void:
	var base = MqContent.card("r_basic_strike")
	var up = MqContent.card("r_basic_strike", true)
	check(up.name != base.name, "upgraded name")
	check(MqContent.card("r_basic_strike", true) == up, "upgrade cache")
	check(up.vars is Dictionary, "vars merged")

# calcDamage (tuning + ascension 8 +1 for normal enemies + curve multiplier) — values printed by core.ts
func test_calc_damage() -> void:
	var cfg = {"commander": "r_huojin", "lieutenant": null, "hp": 70, "maxHp": 70, "deck": [{"id": "r_basic_strike", "up": false}], "relics": [],
		"potions": [null], "fateDeck": [{"suit": "sun", "rank": 5}], "encounter": "enc2_elite_tide_general", "ascension": 8, "seed": "unit-dmg"}
	var s = MqApi.create_combat(cfg)
	var pc = MqBoard.commander_of(s, "player")
	var want = {"e2_tide_general": [141, 5, 3, 9], "e2_drowned_guard": [28, 5, 4, 9], "e2_harpoon": [23, 5, 4, 9]}
	var seen = 0
	for f in MqBoard.units_of(s, "enemy", true):
		var w = want.get(f.def)
		if w == null:
			continue
		seen += 1
		eq(f.hp, w[0], f.def + " hp")
		eq(MqCore.calc_damage(s, f, pc, 10, "attack"), w[1], f.def + " attack 10")
		eq(MqCore.calc_damage(s, f, pc, 7, "effect"), w[2], f.def + " effect 7")
		eq(MqCore.calc_damage(s, pc, f, 9, "attack"), w[3], f.def + " player attack 9")
	eq(seen, 3, "enemies found")
	var cfg2 = cfg.duplicate(true)
	cfg2.encounter = "enc1_spears"
	cfg2.ascension = 0
	var s2 = MqApi.create_combat(cfg2)
	for f in MqBoard.units_of(s2, "enemy", true):
		eq([f.def, f.hp, MqCore.calc_damage(s2, f, MqBoard.commander_of(s2, "player"), 10, "attack")], ["e1_bone_spear", 20, 10], "enc1_spears")

func test_map_deterministic() -> void:
	var a = MqMap.generate_map("seed/map:1", {"act": 1, "hasLieutenant": false, "ascension": 0})
	var b = MqMap.generate_map("seed/map:1", {"act": 1, "hasLieutenant": false, "ascension": 0})
	check(MqParity.diff(MqParity.canon(a), MqParity.canon(b)).is_empty(), "same seed, same map")
	eq(a.rows.size(), 15, "15 rows")
