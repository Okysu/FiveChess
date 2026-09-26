## Glossary texts for tooltips — the UI half of src/engine/glossary.ts (KEYWORDS / STATUSES descriptions and tints,
## TERM_NAMES, EXTRA_TERMS). The rules-relevant half (names, suit / colour info, fill_vars, plain_rules) lives in
## engine/glossary.gd (MqGloss) and is reused from there.
class_name UiGloss
extends RefCounted

const KEYWORDS := {
	"taunt": ["坚守", "敌方普通攻击若能攻击到具有坚守的单位，必须以坚守单位为目标。", "kw_taunt", 0x8fa3b8],
	"ranged": ["远射", "攻击无视距离；攻击单位时不受反击。", "kw_ranged", 0x9fc27a],
	"leap": ["奇袭", "攻击无视深度与坚守。", "kw_leap", 0xc9a0e8],
	"haste": ["疾行", "入场当回合即可攻击。", "kw_haste", 0xf2c46b],
	"twinStrike": ["连斩", "每回合可攻击两次。", "kw_twin", 0xe98a6a],
	"ward": ["灵障", "抵消下一次受到的伤害（可叠层）。", "kw_ward", 0xf5e6a8],
	"lifesteal": ["汲命", "造成伤害时，己方主帅恢复等量生命。", "kw_lifesteal", 0xd65a6a],
	"deathtouch": ["断魂", "对单位造成伤害即将其消灭；对主帅改为额外造成3点伤害。", "kw_deathtouch", 0x7bd18f],
	"thorns": ["棘刺", "受到近战攻击时，对攻击者造成X点伤害。", "kw_thorns", 0x8fbf6a],
	"battlecry": ["起势", "从手牌打出时触发。", "kw_battlecry", 0xf0b45a],
	"deathrattle": ["遗志", "死亡时触发。", "kw_deathrattle", 0x9c8ec7],
	"growth": ["滋长", "我方回合开始时获得+X/+X。", "kw_growth", 0x6fcf7f],
	"aura": ["统御", "相邻友方单位获得所述效果（离场即失效）。", "kw_aura", 0xe8d27a],
	"stealth": ["隐匿", "不能被敌方选为目标，直到其攻击或造成伤害。", "kw_stealth", 0x6f7da8],
	"response": ["应", "可在敌方宣告行动后，以余烬打出。", "kw_response", 0xe0564a],
	"judge": ["判定", "翻开天命牌顶，根据命纹或点数决定结果。", "kw_judge", 0xf2d27a],
	"delay": ["延时", "挂在目标身上，若干回合后判定。", "kw_delay", 0xd9b45e],
	"omen": ["天契", "当一次判定结果为指定命纹时触发。", "kw_omen", 0xf7e3a1],
	"exhaust": ["燃尽", "打出后移出本场战斗。", "kw_exhaust", 0xb07a5a],
	"innate": ["本命", "战斗开始时必定在起手。", "kw_innate", 0xa8d0e8],
	"retain": ["藏锋", "回合结束时不会被弃置。", "kw_retain", 0x9aa8c8],
	"ethereal": ["浮光", "回合结束时若仍在手牌中，将其燃尽。", "kw_ethereal", 0xc8e0f0],
	"combo": ["连势", "若本回合已打出过至少N张其他牌，获得额外效果。", "kw_combo", 0xd08ae0],
	"offering": ["献", "当此牌被献出为源时触发。", "kw_offering", 0xff9a5a],
	"resonance": ["共鸣", "若你拥有至少N枚指定颜色的源，获得额外效果。", "kw_resonance", 0xa0e0d0],
}

const STATUSES := {
	"burn": ["灼烧", "回合开始时受到X点伤害，然后层数减半。", "st_burn", 0xff7a3a],
	"poison": ["中毒", "回合结束时受到X点伤害（无视护甲与灵障），然后层数-1。", "st_poison", 0x8fd35a],
	"freeze": ["冰冻", "不能攻击。回合结束时层数-1。", "st_freeze", 0x8fd8ff],
	"stun": ["眩晕", "跳过下一个行动。生效后短暂免疫眩晕。", "st_stun", 0xf5e16a],
	"vulnerable": ["易伤", "受到的伤害×1.5。回合结束时层数-1。", "st_vulnerable", 0xe86a8a],
	"weak": ["虚弱", "造成的攻击伤害×0.75。回合结束时层数-1。", "st_weak", 0x9a8ac0],
	"silence": ["封印", "失去所有关键词与能力。", "st_silence", 0x7a7a8a],
	"might": ["锋锐", "攻击伤害+X。", "st_might", 0xff5a4a],
	"tenacity": ["坚韧", "获得护甲时额外+X。", "st_tenacity", 0x6aa8e8],
	"regen": ["再生", "回合结束时恢复X点生命，然后层数-1。", "st_regen", 0x6fe08a],
}

const EXTRA_TERMS := {
	"护甲": "抵挡等量伤害。拥有者回合开始时清零。",
	"余烬": "我方回合结束时至多保留2枚可用的源，只能用于支付【应】牌。",
	"源": "献出手牌获得，本场战斗永久存在，每回合重置。",
	"命签": "收入命签区的天命牌（上限2），可用于改判。",
	"窥视": "查看天命牌堆顶的若干张。",
	"观星": "查看天命牌堆顶若干张，任意重排或置底。",
	"改判": "判定牌翻开后，打出一张命签替换它。",
}

static var _terms := {}

## bracket term name -> {kind, id}
static func term_names() -> Dictionary:
	if _terms.is_empty():
		for id in KEYWORDS:
			_terms[KEYWORDS[id][0]] = {"kind": "keyword", "id": id}
		for id in STATUSES:
			_terms[STATUSES[id][0]] = {"kind": "status", "id": id}
		_terms["护甲"] = {"kind": "status", "id": "armor"}
		_terms["余烬"] = {"kind": "keyword", "id": "ember"}
		_terms["源"] = {"kind": "keyword", "id": "source"}
		_terms["命签"] = {"kind": "keyword", "id": "sign"}
		_terms["窥视"] = {"kind": "keyword", "id": "peek"}
		_terms["观星"] = {"kind": "keyword", "id": "stargaze"}
		_terms["改判"] = {"kind": "keyword", "id": "rejudge"}
	return _terms

## highlight colour of a [term] in rules text (null when the term is not a keyword / status)
static func term_tint(name: String):
	var t = term_names().get(name)
	if t == null:
		return null
	if t.kind == "keyword" and KEYWORDS.has(t.id):
		return C.hex(KEYWORDS[t.id][3])
	if t.kind == "status" and STATUSES.has(t.id):
		return C.hex(STATUSES[t.id][3])
	return null

## tooltip lines [{title, body, color?}] for a list of bracket terms (glossLines in widgets.ts)
static func lines(terms: Array) -> Array:
	var out: Array = []
	for name in terms:
		var t = term_names().get(name)
		if t == null:
			continue
		if t.kind == "keyword" and KEYWORDS.has(t.id):
			var k: Array = KEYWORDS[t.id]
			out.append({"title": k[0], "body": k[1], "color": C.hex(k[3])})
		elif t.kind == "status" and STATUSES.has(t.id):
			var k: Array = STATUSES[t.id]
			out.append({"title": k[0], "body": k[1], "color": C.hex(k[3])})
		elif EXTRA_TERMS.has(name):
			out.append({"title": name, "body": EXTRA_TERMS[name]})
	return out

static var _re_term: RegEx

## [term] names in a text, in order, unique (termsOf in hud.ts)
static func terms_of(text: String) -> Array:
	if _re_term == null:
		_re_term = RegEx.create_from_string("\\[([^\\]]+)\\]")
	var out: Array = []
	for m in _re_term.search_all(text):
		var n := m.get_string(1)
		if not out.has(n):
			out.append(n)
	return out
