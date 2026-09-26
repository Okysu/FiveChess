## A fate card (FateCardView in src/game/scenes/combat/fateView.ts): generated fate_face / fate_back textures, the suit
## emblem and rank. Base 120×168, built at scale k (crisp text, real layout size).
class_name FateCard
extends Control

const W := 120.0
const H := 168.0
const RANK := ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]
const CN := ["", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二", "十三"]

var card = null   # {suit, rank, omen?} or null (face down)
var k := 1.0
var selected := false: set = set_selected

signal pressed

static func make(c, scale := 1.0) -> FateCard:
	var f := FateCard.new()
	f.card = c
	f.k = scale
	return f

func _ready() -> void:
	custom_minimum_size = Vector2(W, H) * k
	size = custom_minimum_size
	mouse_filter = Control.MOUSE_FILTER_STOP
	_build()
	gui_input.connect(func(e: InputEvent):
		if e is InputEventMouseButton and not e.pressed and e.button_index == MOUSE_BUTTON_LEFT and not WbScroll.was_drag():
			pressed.emit())

func set_selected(v: bool) -> void:
	selected = v
	var f := get_node_or_null("Sel") as Panel
	if f != null:
		f.visible = v

func _lbl(text: String, font: String, px: float, col: Color, outline: float) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", C.font(font))
	l.add_theme_font_size_override("font_size", maxi(1, int(round(px * k))))
	l.add_theme_color_override("font_color", col)
	if outline > 0:
		l.add_theme_color_override("font_outline_color", C.wb_ink)
		l.add_theme_constant_override("outline_size", maxi(1, int(round(outline * k))))
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l

func _build() -> void:
	var sel := Panel.new()
	sel.name = "Sel"
	sel.add_theme_stylebox_override("panel", Wb.nine("frame_gold", {"expand": 8.0 * k, "corner_scale": k}))
	sel.size = size
	sel.visible = selected
	sel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(sel)
	if card == null:
		add_child(Wb.sprite("fate_back", size, {"stretch": true}))
		return
	var omen: bool = card.get("omen", false) == true
	add_child(Wb.sprite("fate_face", size, {"stretch": true, "modulate": Color8(0x5a, 0x2a, 0x22) if omen else Color.WHITE}))
	var info: Dictionary = MqGloss.SUIT_INFO[card.suit]
	if omen:
		var x := _lbl("凶", "title", 64, C.wb_vermilion, 6)
		x.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		x.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		x.size = size
		add_child(x)
		return
	var em := Wb.suit_icon(card.suit, 70 * k)
	em.position = Vector2((W - 70) / 2.0, (H - 70) / 2.0 + 6) * k
	add_child(em)
	var col := C.hex(info.color)
	var r1 := _lbl(RANK[card.rank], "num", 36, col, 6)
	r1.position = Vector2(8, 0) * k
	add_child(r1)
	var r2 := _lbl(RANK[card.rank], "num", 36, col, 6)
	r2.size = Vector2(60, 50) * k
	r2.pivot_offset = r2.size / 2.0
	r2.rotation = PI
	r2.position = Vector2(W - 8 - 60, H - 50) * k
	add_child(r2)
	var cn := _lbl(CN[card.rank], "title", 16, C.wb_ink, 0)
	cn.position = Vector2(12, 48) * k
	add_child(cn)
	if Session.settings.get("suitText", false):
		var nm := _lbl(String(info.name)[0], "title", 16, C.wb_ink, 0)
		nm.position = Vector2(W - 28, 8) * k
		add_child(nm)
