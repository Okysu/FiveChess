## Visual tokens: text / tint colours (never used to draw shapes) and fonts — port of src/game/ui/theme.ts and the
## WB palette of src/game/ui/skin.ts.
class_name C
extends RefCounted

# theme.ts C
const ink := Color8(0x14, 0x10, 0x0e)
const ink2 := Color8(0x22, 0x1a, 0x16)
const paper := Color8(0xef, 0xe4, 0xcc)
const paper_dark := Color8(0xd8, 0xc8, 0xa6)
const gold := Color8(0xd9, 0xa2, 0x3a)
const gold_light := Color8(0xf3, 0xd4, 0x88)
const gold_dark := Color8(0x8a, 0x5e, 0x1a)
const cinnabar := Color8(0xc8, 0x32, 0x1f)
const jade := Color8(0x3f, 0xa8, 0x70)
const red := Color8(0xe0, 0x47, 0x3a)
const green := Color8(0x6f, 0xe0, 0x8a)
const blue := Color8(0x6a, 0xa8, 0xe8)
const white := Color(1, 1, 1)
const text := Color8(0xf3, 0xe6, 0xc6)
const text_dim := Color8(0xb5, 0xa3, 0x84)
const text_dark := Color8(0x2a, 0x1f, 0x18)
const hp := Color8(0xd2, 0x3a, 0x32)
const armor := Color8(0x7f, 0xa6, 0xd6)
const black := Color(0, 0, 0)

# skin.ts WB (woodblock palette)
const wb_ink := Color8(0x1b, 0x15, 0x12)
const wb_paper := Color8(0xea, 0xdb, 0xb6)
const wb_vermilion := Color8(0xc8, 0x32, 0x1f)
const wb_vermilion_dk := Color8(0x8a, 0x1f, 0x12)
const wb_white := Color8(0xfa, 0xf3, 0xe0)

# misc text colours used by several screens
const body_light := Color8(0xea, 0xdf, 0xc8)   # rich text on dark panels
const good := Color8(0x9a, 0xdf, 0xa8)
const bad := Color8(0xff, 0x9a, 0x8a)
const term := Color8(0xff, 0xd2, 0x7a)

const RARITY_NAME := {"basic": "基础", "common": "普通", "rare": "稀有", "epic": "史诗", "legendary": "传说", "token": "衍生", "special": "特殊"}
const TYPE_NAME := {"unit": "随从", "tactic": "策略", "response": "应对", "equip": "装备", "delay": "延时", "field": "阵地", "status": "状态", "curse": "诅咒"}
const SKILL_TYPE := {"passive": "被动", "active": "主动", "limited": "限定技", "awaken": "觉醒技"}
const ACT_NAMES := {1: "残碑林", 2: "沉渊城", 3: "星殿", 4: "命书之心"}
const NUM_CN := ["零", "一", "二", "三", "四"]

static func hex(n: int) -> Color:
	return Color8((n >> 16) & 255, (n >> 8) & 255, n & 255)

static func faction(f: String) -> Color:
	return hex(MqGloss.COLOR_INFO[f].hex)

static func faction_light(f: String) -> Color:
	return hex(MqGloss.COLOR_INFO[f].light)

static func act_name(a: int) -> String:
	return ACT_NAMES.get(a, "")

static func html(c: Color) -> String:
	return "#" + c.to_html(false)

# ───────────── fonts ─────────────
static var _fonts := {}

## "title" (heavy Song, carved headings), "body" (Song), "bold", "num" (heavy numbers), "brush" (Ma Shan Zheng)
static func font(kind: String) -> Font:
	if _fonts.has(kind):
		return _fonts[kind]
	var f: Font
	match kind:
		"brush":
			f = load("res://fonts/MaShanZheng-Regular.ttf")
		_:
			var base: FontFile = load("res://fonts/NotoSerifSC-VF.ttf")
			var v := FontVariation.new()
			v.base_font = base
			var w := {"title": 900, "num": 900, "bold": 700, "body": 500}.get(kind, 500)
			v.variation_opentype = {TextServerManager.get_primary_interface().name_to_tag("wght"): w}
			f = v
	_fonts[kind] = f
	return f
