## Port of src/engine/glossary.ts — only the rules-relevant data (names, suit/color info) and the text helpers.
class_name MqGloss
extends RefCounted

const KEYWORD_NAMES := {
	"taunt": "坚守", "ranged": "远射", "leap": "奇袭", "haste": "疾行", "twinStrike": "连斩", "ward": "灵障",
	"lifesteal": "汲命", "deathtouch": "断魂", "thorns": "棘刺", "battlecry": "起势", "deathrattle": "遗志",
	"growth": "滋长", "aura": "统御", "stealth": "隐匿", "response": "应", "judge": "判定", "delay": "延时",
	"omen": "天契", "exhaust": "燃尽", "innate": "本命", "retain": "藏锋", "ethereal": "浮光", "combo": "连势",
	"offering": "献", "resonance": "共鸣",
}

const STATUS_INFO := {
	"burn": {"name": "灼烧", "debuff": true}, "poison": {"name": "中毒", "debuff": true},
	"freeze": {"name": "冰冻", "debuff": true}, "stun": {"name": "眩晕", "debuff": true},
	"vulnerable": {"name": "易伤", "debuff": true}, "weak": {"name": "虚弱", "debuff": true},
	"silence": {"name": "封印", "debuff": true}, "might": {"name": "锋锐", "debuff": false},
	"tenacity": {"name": "坚韧", "debuff": false}, "regen": {"name": "再生", "debuff": false},
}

const SUIT_INFO := {
	"sun": {"name": "日纹", "yang": true, "color": 0xf2a33a, "shape": "circle"},
	"thunder": {"name": "雷纹", "yang": true, "color": 0xa77be8, "shape": "bolt"},
	"moon": {"name": "月纹", "yang": false, "color": 0x8ec5f0, "shape": "crescent"},
	"mountain": {"name": "山纹", "yang": false, "color": 0x6fb58a, "shape": "triangle"},
}

const COLOR_INFO := {
	"R": {"name": "赤", "school": "焚阳宗", "hex": 0xc8321f, "dark": 0x6a160c, "light": 0xf08a5a},
	"B": {"name": "玄", "school": "镇岳门", "hex": 0x2a4f8a, "dark": 0x14223e, "light": 0x7aa2d8},
	"G": {"name": "青", "school": "万木庭", "hex": 0x2f8a5f, "dark": 0x143a26, "light": 0x7ac89a},
	"Y": {"name": "金", "school": "观星阁", "hex": 0xd9a23a, "dark": 0x6a4a10, "light": 0xf5d68a},
	"P": {"name": "紫", "school": "幽弈坊", "hex": 0x6e3a78, "dark": 0x2e1236, "light": 0xb88ac8},
	"N": {"name": "素", "school": "中立", "hex": 0xa89a80, "dark": 0x4a4234, "light": 0xe8dcc0},
}

static var _re_var: RegEx
static var _re_tok: RegEx

## plain-text form of card rules: "{a}" -> the card's value (suit/pip tokens like {sun} are left alone)
static func fill_vars(text: String, vars = null) -> String:
	if vars == null:
		return text
	if _re_var == null:
		_re_var = RegEx.create_from_string("\\{([A-Za-z0-9_]+)\\}")
	var out = ""
	var last = 0
	for m in _re_var.search_all(text):
		out += text.substr(last, m.get_start() - last)
		var k = m.get_string(1)
		out += MqU.js_string(vars[k]) if vars.has(k) else m.get_string()
		last = m.get_end()
	return out + text.substr(last)

## rules text for plain Text: values filled, [term] brackets and suit/pip tokens removed
static func plain_rules(text: String, vars = null) -> String:
	if _re_tok == null:
		_re_tok = RegEx.create_from_string("\\{(sun|thunder|moon|mountain|R|B|G|Y|P|N)\\}")
	return _re_tok.sub(fill_vars(text, vars), "", true).replace("[", "").replace("]", "")
