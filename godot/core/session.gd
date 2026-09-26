## Global game session (port of src/game/state.ts): meta profile, settings, the current run & combat, persistence.
## Saves are JSON files in user://save/ with the same data shapes as the web version's IndexedDB records
## ('profile', 'settings', 'run' = {run, combat}).
extends Node

const DIR := "user://save/"

var profile: Dictionary = {}
var settings: Dictionary = {}
var run = null          # RunState Dictionary or null
var combat = null       # CombatState Dictionary or null
var last_unlocks: Array = []
var _recorded := false
## the UI tour and tests switch persistence off so the player's save is never touched
var persist := true

static func default_settings() -> Dictionary:
	return {
		"volume": {"master": 0.8, "music": 0.5, "sfx": 0.8, "ambient": 0.5}, "animSpeed": 1, "skipAnims": false, "fastJudge": false,
		"responseMode": "smart", "responseTimer": 8, "confirmEndTurn": false, "colorblind": "none", "suitText": false,
		"screenShake": 1, "damageNumbers": true, "tutorialHints": true, "profile": "auto",
	}

func _ready() -> void:
	settings = default_settings()

func load_all() -> void:
	profile = MqMeta.new_profile()
	var p = _load("profile")
	if p is Dictionary:
		for k in p:
			profile[k] = p[k]
	settings = default_settings()
	var s = _load("settings")
	if s is Dictionary:
		for k in s:
			settings[k] = s[k]
	var rs = _load("run")
	if rs is Dictionary and rs.get("run") is Dictionary and rs.run.get("result") == null:
		run = rs.run
		combat = _restore_combat(rs.get("combat"))
	apply_settings()

## JSON keys are strings: combat units are keyed by int uid in the engine
func _restore_combat(c):
	if not (c is Dictionary):
		return null
	var units := {}
	for k in c.get("units", {}):
		units[int(k)] = c.units[k]
	c.units = units
	return c

func apply_settings() -> void:
	var v: Dictionary = settings.volume
	for b in ["master", "music", "sfx", "ambient"]:
		Audio.set_volume(b, float(v.get(b, 0.8)))
	Wb.color_glyphs = settings.get("colorblind", "none") != "none"
	Layout.set_override(String(settings.get("profile", "auto")))

func save_settings() -> void:
	apply_settings()
	_save("settings", settings)

func save_profile() -> void:
	_save("profile", profile)

func save_run() -> void:
	if run != null:
		_save("run", {"run": run, "combat": combat})

func start_run(commander: String, ascension: int, seed := "") -> void:
	var s := seed.strip_edges()
	if s == "":
		const ABC := "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
		for i in 8:
			s += ABC[randi() % ABC.length()]
	var tutorial: bool = not profile.get("tutorialDone", false)
	run = MqRun.new_run({"seed": s, "commander": commander, "ascension": ascension, "tutorial": tutorial,
		"locked": MqMeta.locked_content(profile), "unlockedHidden": profile.get("hiddenUnlocked", false)})
	combat = null
	_recorded = false
	save_run()

## apply a run action and persist; returns null or an error code
func act(a: Dictionary):
	if run == null:
		return "no run"
	var err = MqRun.run_act(run, a)
	if err == null and run.get("result") != null and not _recorded:
		end_run()
	if err == null:
		save_run()
	return err

func ensure_combat() -> Dictionary:
	if combat == null:
		combat = MqApi.create_combat(MqRun.combat_config(run))
		save_run()
	return combat

func finish_combat() -> void:
	var c = combat
	var r = run
	if c == null or r == null:
		return
	var enemies: Array = []
	for uid in c.units:
		var u: Dictionary = c.units[uid]
		if u.side == "enemy" and u.origin == "enemy" and not enemies.has(u.def):
			enemies.append(u.def)
	var pc = c.units.get(c.sides.player.commander)
	MqRun.run_act(r, {"t": "combatResult", "result": "win" if c.over == "win" else "lose", "hp": pc.hp if pc != null else 0,
		"gold": c.goldGained, "potions": c.potions, "relics": c.relics, "stats": c.stats, "enemies": enemies})
	combat = null
	if r.get("result") != null and not _recorded:
		end_run()
	save_run()

func end_run(abandon := false) -> void:
	var r = run
	if r == null or _recorded:
		return
	_recorded = true
	if abandon:
		r.result = "lose"
	var deck: Array = []
	for d in r.deck:
		deck.append(d.id + ("+" if d.up else ""))
	var relics: Array = []
	for x in r.relics:
		relics.append(x.id)
	var summary := {
		"seed": r.seed, "commander": r.commander, "lieutenant": r.lieutenant, "ascension": r.ascension,
		"result": "abandon" if abandon else (r.result if r.result != null else "lose"),
		"act": r.act, "floor": r.floor, "score": MqMeta.run_score(r), "date": int(Time.get_unix_time_from_system() * 1000.0), "deck": deck,
		"relics": relics, "nemesis": r.get("nemesis"), "turns": r.stats.turns, "maxDamage": r.stats.maxDamage, "log": {"runLog": r.get("log", [])},
	}
	last_unlocks = MqMeta.record_run(profile, r, summary)
	save_profile()
	_clear("run")

func abandon() -> void:
	end_run(true)
	run = null
	combat = null

# ───────────── persistence ─────────────

func _load(key: String):
	var path := DIR + key + ".json"
	if not FileAccess.file_exists(path):
		return null
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return null
	var j = JSON.parse_string(f.get_as_text())
	return MqU.json_norm(j) if j != null else null

func _save(key: String, v) -> void:
	if not persist:
		return
	DirAccess.make_dir_recursive_absolute(DIR)
	var f := FileAccess.open(DIR + key + ".json", FileAccess.WRITE)
	if f != null:
		f.store_string(JSON.stringify(v))

func _clear(key: String) -> void:
	if not persist:
		return
	var path := DIR + key + ".json"
	if FileAccess.file_exists(path):
		DirAccess.remove_absolute(path)
