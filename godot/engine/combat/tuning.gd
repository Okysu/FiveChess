## Port of src/engine/combat/tuning.ts — difficulty curve (enemy HP / damage multipliers by act, tier, encounter).
class_name MqTuning
extends RefCounted

const BY_ACT_TIER := {
	1: {"easy": {"hp": 1, "dmg": 1}, "normal": {"hp": 0.9, "dmg": 0.8}, "elite": {"hp": 0.9, "dmg": 0.9}, "boss": {"hp": 0.85, "dmg": 0.85}},
	2: {"easy": {"hp": 0.78, "dmg": 0.65}, "normal": {"hp": 0.78, "dmg": 0.62}, "elite": {"hp": 0.76, "dmg": 0.64}, "boss": {"hp": 0.62, "dmg": 0.6}},
	3: {"easy": {"hp": 0.65, "dmg": 0.52}, "normal": {"hp": 0.65, "dmg": 0.52}, "elite": {"hp": 0.62, "dmg": 0.54}, "boss": {"hp": 0.57, "dmg": 0.58}},
	4: {"easy": {"hp": 1, "dmg": 1}, "normal": {"hp": 1, "dmg": 1}, "elite": {"hp": 1, "dmg": 1}, "boss": {"hp": 0.62, "dmg": 0.66}},
}

## outliers the simulator flagged, multiplied on top of the act/tier row (keep in sync with tuning.ts)
const BY_ENCOUNTER := {
	"enc1_tomb_guard": {"hp": 1, "dmg": 0.8},
	"enc1_crossbows": {"hp": 1, "dmg": 0.85},
	"enc1_robbers": {"hp": 1, "dmg": 0.85},
	"enc1_graveyard": {"hp": 0.9, "dmg": 1},
	"enc1_boss_blank_stele": {"hp": 0.95, "dmg": 0.9},
	"enc1_boss_fox_mother": {"hp": 0.95, "dmg": 0.88},
	"enc1_boss_rust_general": {"hp": 0.92, "dmg": 0.92},
	"enc2_silt_swarm": {"hp": 1, "dmg": 0.8},
	"enc2_clerks": {"hp": 0.9, "dmg": 0.75},
	"enc2_drowned_watch": {"hp": 0.85, "dmg": 0.72},
	"enc2_tide_rite": {"hp": 0.9, "dmg": 0.8},
	"enc2_deep_hunt": {"hp": 0.9, "dmg": 0.82},
	"enc2_clock_scholar": {"hp": 0.95, "dmg": 0.85},
	"enc2_elite_tide_general": {"hp": 0.9, "dmg": 0.8},
	"enc2_elite_coral_colossus": {"hp": 0.85, "dmg": 0.85},
	"enc2_boss_twin_judges": {"hp": 0.72, "dmg": 0.72},
	"enc2_boss_puppeteer": {"hp": 0.82, "dmg": 0.78},
	"enc2_boss_drowned_king": {"hp": 0.9, "dmg": 0.9},
	"enc3_flock_of_stars": {"hp": 0.75, "dmg": 0.7},
	"enc3_night_ink": {"hp": 0.8, "dmg": 0.72},
	"enc3_hall_of_mirrors": {"hp": 0.8, "dmg": 0.72},
	"enc3_lamp_vigil": {"hp": 0.85, "dmg": 0.8},
	"enc3_lamp_procession": {"hp": 0.75, "dmg": 0.7},
	"enc3_meteor_charge": {"hp": 0.9, "dmg": 0.8},
	"enc3_orrery": {"hp": 0.85, "dmg": 0.8},
	"enc3_tolling_hall": {"hp": 0.85, "dmg": 0.7},
	"enc3_forbidden_stacks": {"hp": 0.8, "dmg": 0.85},
	"enc3_boss_sunbird_shadow": {"hp": 0.72, "dmg": 0.7},
	"enc3_elite_ink_leviathan": {"hp": 0.9, "dmg": 0.85},
	"enc3_boss_eclipse_tengu": {"hp": 0.9, "dmg": 0.9},
}

static var _cache := {}
static var enabled := true

## rule tests run on untuned numbers so their exact expectations stay about the rules
static func set_tuning(on: bool) -> void:
	enabled = on
	_cache.clear()

## returns {hp, dmg} (products computed as doubles exactly like the TS numbers)
static func encounter_tune(encounter_id: String) -> Dictionary:
	if not enabled:
		return {"hp": 1, "dmg": 1}
	var hit = _cache.get(encounter_id)
	if hit != null:
		return hit
	var enc = MqContent.encounters.get(encounter_id)
	var t = {"hp": 1, "dmg": 1}
	if enc != null and encounter_id != "sandbox":
		var row: Dictionary = BY_ACT_TIER[clampi(int(enc.act), 1, 4)]
		var tier: String = "easy" if enc.tier == "normal" and enc.get("pool") == "easy" else String(enc.tier)
		var base = row.get(tier, {"hp": 1, "dmg": 1})
		var o = BY_ENCOUNTER.get(encounter_id, {"hp": 1, "dmg": 1})
		t = {"hp": base.hp * o.hp, "dmg": base.dmg * o.dmg}
	_cache[encounter_id] = t
	return t

static func combat_tune(s: Dictionary) -> Dictionary:
	return encounter_tune(s.cfg.encounter)
