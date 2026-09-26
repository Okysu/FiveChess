## Card view (port of CardView in src/game/ui/card.ts) — every visual is a generated woodblock texture.
## Base size 300×420, built at any scale `k` (positions AND font sizes are multiplied, so text stays crisp and the
## card's minimum size is its real size: it lays out in containers like any control).
## Layers: glow frame → paper body → art window (textured polygon per card type) → school frame (9-slice) → name
## ribbon (+ rarity gem) → response seal → cost disc with the TOTAL cost + coloured source pips → rules text →
## stat badges; a card back when face down.
## Signals: pressed (left tap), inspect (right click / long press), hovered(bool).
class_name CardView
extends Control

signal pressed
signal inspect
signal hovered(on: bool)

const W := 300.0
const H := 420.0
const ART := Rect2(26, 28, 248, 180)
const RULES := Rect2(42, 262, 216, 120)
const RIBBON_Y := 200.0
const SCENE := "res://ui/card.tscn"

var card_id := ""
var up := false
var uid := -1
var def: Dictionary = {}
var k := 1.0
var live := {}
var glow_state := "none"
var face_down := false
var hover_grow := true
var _built := false
var _hover := false
var _press_t := -1.0

## a card view at scale k (live: cost {g, c, x}, payable, missing, vars, atk, hp)
static func make(id: String, is_up := false, scale := 1.0, live_info := {}, card_uid := -1) -> CardView:
	var v: CardView = load(SCENE).instantiate()
	v.card_id = id
	v.up = is_up
	v.k = scale
	v.live = live_info
	v.uid = card_uid
	return v

func _ready() -> void:
	def = MqContent.card(card_id, up)
	custom_minimum_size = Vector2(W, H) * k
	size = custom_minimum_size
	pivot_offset = size / 2.0
	mouse_filter = Control.MOUSE_FILTER_STOP
	mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	_build()
	mouse_entered.connect(_on_enter)
	mouse_exited.connect(_on_exit)
	gui_input.connect(_on_input)
	resized.connect(func(): pivot_offset = size / 2.0)

func _s(v: float) -> float:
	return v * k

func _r(r: Rect2) -> Rect2:
	return Rect2(r.position * k, r.size * k)

func _build() -> void:
	var d := def
	var f: String = d.faction
	# glow / legendary frame (behind)
	var glow := %Glow as Panel
	glow.position = Vector2.ZERO
	glow.size = Vector2(W, H) * k
	glow.visible = false
	var legend := %Legend as Panel
	legend.size = Vector2(W, H) * k
	legend.visible = d.rarity == "legendary"
	legend.add_theme_stylebox_override("panel", Wb.nine("frame_gold", {"expand": _s(8), "corner_scale": k}))
	# paper body (rounded corners hidden under the frame)
	var paper := %Paper as Polygon2D
	_tex_poly(paper, Wb.tex("tex_paper"), _round_rect(Rect2(4, 4, W - 8, H - 8), 12), Rect2(Vector2.ZERO, Vector2(W, H)), 0.5)
	# art window: the placeholder print under the card art
	var pts := _art_window(d.type)
	_tex_poly(%Placeholder as Polygon2D, Wb.tex("art_placeholder"), pts, Rect2(Vector2.ZERO, Vector2(W, H)), 0.5)
	var art_tex := Assets.tex(K.card(f, card_id))
	(%Art as Polygon2D).visible = art_tex != null
	if art_tex != null:
		_tex_poly(%Art as Polygon2D, art_tex, pts, ART, 0.35)
		(%Placeholder as Polygon2D).visible = false
	# frame + ribbon
	var frame := %Frame as Panel
	frame.size = Vector2(W, H) * k
	frame.add_theme_stylebox_override("panel", Wb.nine("card_frame_" + f, {"corner_scale": k}))
	var ribbon := %Ribbon as Panel
	ribbon.position = Vector2(-8, RIBBON_Y) * k
	ribbon.size = Vector2(W + 16, 54) * k
	ribbon.add_theme_stylebox_override("panel", Wb.nine("ribbon_" + f, {"corner_scale": k}))
	var nm := %Name as Label
	nm.text = String(d.name) + ("+" if up and not String(d.name).ends_with("+") else "")
	var nsize := 21.0 if String(d.name).length() > 6 else 25.0
	nm.add_theme_font_size_override("font_size", maxi(1, int(round(nsize * k))))
	nm.add_theme_constant_override("outline_size", maxi(1, int(round(5 * k))))
	nm.add_theme_color_override("font_color", Color8(0xc8, 0xff, 0xb0) if up else C.wb_white)
	var fnt := nm.get_theme_font("font")
	var tw := fnt.get_string_size(nm.text, HORIZONTAL_ALIGNMENT_LEFT, -1, int(round(nsize * k))).x
	if tw > (W - 90) * k:
		nm.add_theme_font_size_override("font_size", maxi(1, int(floor(nsize * k * (W - 90) * k / tw))))
	nm.position = Vector2(0, RIBBON_Y) * k
	nm.size = Vector2(W, 54) * k
	# rarity gem on the ribbon's right scroll end
	var gem := %Gem as TextureRect
	gem.visible = not ["basic", "token", "special"].has(d.rarity)
	gem.texture = Wb.tex(Wb.gem_id(d.rarity))
	gem.size = Vector2(24, 24) * k
	gem.position = (Vector2(W - 30, RIBBON_Y + 27) - Vector2(12, 12)) * k
	# response seal
	var seal := %Seal as Control
	var kws = d.get("keywords")
	seal.visible = d.type == "response" or (kws != null and kws.has("response"))
	seal.size = Vector2(50, 50) * k
	seal.pivot_offset = seal.size / 2.0
	seal.position = (Vector2(W - 40, 44) - Vector2(25, 25)) * k
	seal.rotation = 0.08
	(%SealTex as TextureRect).texture = Wb.tex("seal_response")
	var st := %SealText as Label
	st.add_theme_font_size_override("font_size", maxi(1, int(round(28 * k))))
	st.add_theme_constant_override("outline_size", maxi(1, int(round(3 * k))))
	# rules box
	var rules := %Rules as RichLabel
	rules.position = RULES.position * k
	rules.size = RULES.size * k
	rules.custom_minimum_size = Vector2(RULES.size.x * k, 0)
	rules.fit_content = false
	rules.clip_contents = false
	(%Back as TextureRect).texture = Wb.tex("card_back")
	(%Back as TextureRect).size = Vector2(W, H) * k
	_built = true
	update_live(live)
	set_face_down(face_down)

## polygon of the art window for each card type (artWindow in card.ts)
func _art_window(type: String) -> PackedVector2Array:
	var x := ART.position.x
	var y := ART.position.y
	var w := ART.size.x
	var h := ART.size.y
	var pts := PackedVector2Array()
	match type:
		"unit":
			pts.append(Vector2(x, y + h))
			_arc(pts, Vector2(x + 50, y + 50), 50, PI, PI * 1.5)
			_arc(pts, Vector2(x + w - 50, y + 50), 50, PI * 1.5, PI * 2)
			pts.append(Vector2(x + w, y + h))
		"response":
			for p in [[x + 20, y], [x + w - 20, y], [x + w, y + 20], [x + w, y + h - 20], [x + w - 20, y + h], [x + 20, y + h], [x, y + h - 20], [x, y + 20]]:
				pts.append(Vector2(p[0], p[1]))
		"delay":
			for p in [[x, y], [x + w, y], [x + w - 22, y + h / 2], [x + w, y + h], [x, y + h], [x + 22, y + h / 2]]:
				pts.append(Vector2(p[0], p[1]))
		"equip":
			pts.append(Vector2(x, y + h))
			pts.append(Vector2(x, y + 36))
			_arc(pts, Vector2(x + w / 2, y + 36 + w * 0.9 - 62), w * 0.9, PI * 1.36, PI * 1.64, 16)
			pts.append(Vector2(x + w, y + 36))
			pts.append(Vector2(x + w, y + h))
		_:
			pts = U.rect_points(ART)
	return pts

func _arc(pts: PackedVector2Array, c: Vector2, r: float, a0: float, a1: float, n := 10) -> void:
	for i in n + 1:
		var a := a0 + (a1 - a0) * i / n
		pts.append(c + Vector2(cos(a), sin(a)) * r)

func _round_rect(r: Rect2, rad: float) -> PackedVector2Array:
	var pts := PackedVector2Array()
	_arc(pts, r.position + Vector2(rad, rad), rad, PI, PI * 1.5, 4)
	_arc(pts, Vector2(r.end.x - rad, r.position.y + rad), rad, PI * 1.5, PI * 2, 4)
	_arc(pts, r.end - Vector2(rad, rad), rad, 0, PI * 0.5, 4)
	_arc(pts, Vector2(r.position.x + rad, r.end.y - rad), rad, PI * 0.5, PI, 4)
	return pts

## texture a polygon (base coords) with `tex` cover-fitted into `rect` (base coords)
func _tex_poly(p: Polygon2D, tex: Texture2D, pts: PackedVector2Array, rect: Rect2, focus_y: float) -> void:
	var scaled := PackedVector2Array()
	for pt in pts:
		scaled.append(pt * k)
	var src := U.tex_window(tex, scaled, _r(rect), focus_y)
	p.polygon = src.polygon
	p.texture = src.texture
	p.uv = src.uv
	p.visible = tex != null
	src.free()

## live values (combat): cost {g, c, x}, payable, missing (colours), vars {k: {value, base}}, atk, hp
func update_live(l: Dictionary) -> void:
	live = l
	if not _built:
		return
	var d := def
	var cg = d.cost.g
	var base_g := 0 if typeof(cg) == TYPE_STRING else int(cg)
	var base_c: Array = d.cost.get("c", []) if d.cost.get("c") != null else []
	var cost: Dictionary = l.get("cost", {"g": base_g, "c": base_c, "x": typeof(cg) == TYPE_STRING})
	var payable = l.get("payable")
	# cost disc: the TOTAL sources needed; coloured ones are also shown as pips below
	var disc := %CostDisc as TextureRect
	disc.texture = Wb.tex("cost_disc")
	disc.size = Vector2(72, 72) * k
	disc.position = Vector2(4, 4) * k
	disc.modulate = Color8(0xa8, 0x9a, 0x90) if payable == false else Color.WHITE
	var total: int = int(cost.g) + cost.c.size()
	var base_total := base_g + base_c.size()
	var num := %CostNum as Label
	num.text = ("X+%d" % cost.c.size() if cost.c.size() > 0 else "X") if cost.get("x", false) else str(total)
	num.add_theme_color_override("font_color", Color8(0x9a, 0xff, 0x8a) if total < base_total else Color8(0xff, 0x8a, 0x6a) if total > base_total else Color8(0xc8, 0xb8, 0xa8) if payable == false else C.wb_white)
	var nsz := 34.0
	var nf := num.get_theme_font("font")
	var nw := nf.get_string_size(num.text, HORIZONTAL_ALIGNMENT_LEFT, -1, int(nsz * k)).x
	if nw > 56 * k:
		nsz *= 56 * k / nw
	num.add_theme_font_size_override("font_size", maxi(1, int(round(nsz * k))))
	num.add_theme_constant_override("outline_size", maxi(1, int(round(6 * k))))
	num.position = Vector2(4, 3) * k
	num.size = Vector2(72, 72) * k
	var pips := %Pips as Control
	U.clear(pips)
	var missing: Array = l.get("missing", []).duplicate()
	for i in cost.c.size():
		var c: String = cost.c[i]
		var mi := missing.find(c)
		if mi >= 0:
			missing.remove_at(mi)
		var p := Wb.pip(c, 32 * k, mi >= 0)
		p.position = (Vector2(40, 94 + i * 32) - Vector2(16, 16)) * k
		pips.add_child(p)
	# rules text
	var rules := %Rules as RichLabel
	var vars := Rich.card_vars(d, l.get("vars", {}))
	rules.set_rich(String(d.text), {"size": 21.0 * k, "raw": true, "color": Color8(0x1e, 0x14, 0x0c), "vars": vars, "align": "center", "bold": true, "line": int(round(-2 * k))})
	rules.size = RULES.size * k
	rules.fit(RULES.size.y * k, maxi(1, int(round(11 * k))))
	var ch := rules.get_content_height()
	rules.position = Vector2(RULES.position.x * k, RULES.position.y * k + maxf(0.0, (RULES.size.y * k - ch) / 2.0))
	# stat badges
	var stats := %Stats as Control
	U.clear(stats)
	if d.type == "unit" and d.get("unit") != null:
		stats.add_child(_badge("atk", l.get("atk", d.unit.atk), d.unit.atk, Vector2(30, H - 28)))
		stats.add_child(_badge("hp", l.get("hp", d.unit.hp), d.unit.hp, Vector2(W - 30, H - 28)))
	elif d.type == "equip" and d.get("equip") != null:
		if d.equip.get("atk") != null:
			stats.add_child(_badge("atk", d.equip.atk, d.equip.atk, Vector2(30, H - 28)))
		if MqU.truthy(d.equip.get("durability")):
			stats.add_child(_badge("dur", d.equip.durability, d.equip.durability, Vector2(W - 30, H - 28)))
	elif d.type == "delay" and d.get("delay") != null:
		stats.add_child(_badge("turns", d.delay.turns, d.delay.turns, Vector2(W - 30, H - 28)))
	elif d.type == "field" and d.get("field") != null and MqU.truthy(d.field.get("duration")):
		stats.add_child(_badge("turns", d.field.duration, d.field.duration, Vector2(W - 30, H - 28)))

func _badge(kind: String, value, base, center: Vector2, sz := 54.0) -> Control:
	var c := Control.new()
	c.mouse_filter = Control.MOUSE_FILTER_IGNORE
	c.size = Vector2(sz, sz) * k
	c.position = (center - Vector2(sz, sz) / 2.0) * k
	var t := Wb.sprite("stat_" + kind, c.size)
	c.add_child(t)
	var l := Label.new()
	l.theme_type_variation = "Num"
	l.text = str(value)
	l.add_theme_font_size_override("font_size", maxi(1, int(round(sz * 0.48 * k))))
	l.add_theme_constant_override("outline_size", maxi(1, int(round(6 * k))))
	l.add_theme_color_override("font_color", Color8(0x9a, 0xff, 0x8a) if value > base else Color8(0xff, 0x8a, 0x6a) if value < base else C.wb_white)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	l.size = c.size
	l.position = Vector2(0, 1 * k)
	c.add_child(l)
	return c

## selection / playable frames: none | playable | response | selected | danger
func set_glow(state: String) -> void:
	glow_state = state
	var g := %Glow as Panel
	g.visible = state != "none"
	if state != "none":
		var col := "gold" if state == "playable" else "blue" if state == "selected" else "red"
		g.add_theme_stylebox_override("panel", Wb.nine("frame_" + col, {"expand": _s(12), "corner_scale": k}))

func set_face_down(down: bool) -> void:
	face_down = down
	if not _built:
		return
	(%Back as TextureRect).visible = down
	(%Face as Control).visible = not down

func rules_terms() -> Array:
	return UiGloss.terms_of(String(def.text))

func _on_enter() -> void:
	_hover = true
	if hover_grow and not face_down:
		create_tween().tween_property(self, "scale", Vector2(1.06, 1.06), 0.1)
	Audio.sfx("cardHover")
	hovered.emit(true)

func _on_exit() -> void:
	_hover = false
	if hover_grow:
		create_tween().tween_property(self, "scale", Vector2.ONE, 0.1)
	hovered.emit(false)

func _on_input(e: InputEvent) -> void:
	if e is InputEventMouseButton:
		if e.button_index == MOUSE_BUTTON_RIGHT and e.pressed:
			inspect.emit()
			accept_event()
		elif e.button_index == MOUSE_BUTTON_LEFT:
			if e.pressed:
				_press_t = Time.get_ticks_msec()
			elif _press_t >= 0.0:
				var held := Time.get_ticks_msec() - _press_t
				_press_t = -1.0
				if WbScroll.was_drag() or not get_global_rect().has_point(get_global_mouse_position()):
					return
				if held > 550 and Layout.is_phone():
					inspect.emit()
				else:
					pressed.emit()
