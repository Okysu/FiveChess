## Small UI construction helpers shared by the screens (labels, carved titles, boxes, masked portraits, toasts).
class_name U
extends RefCounted

## a Label of a theme variation; size (unscaled px) goes through Layout.fs(); color overrides the variation's colour
static func label(text: String, variation := "Body", size := 0, color = null) -> Label:
	var l := Label.new()
	l.text = text
	l.theme_type_variation = variation
	if size > 0:
		l.add_theme_font_size_override("font_size", Layout.fs(size))
	if color != null:
		l.add_theme_color_override("font_color", color)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l

## a wrapping label (fills its container's width)
static func para(text: String, variation := "Body", size := 0, color = null) -> Label:
	var l := label(text, variation, size, color)
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return l

## carved heading (title() in widgets.ts): heavy Song type, paper-ochre fill, thick ink outline, offset vermilion print
## shadow. The size is used as given (big titles are not scaled by the profile).
static func title(text: String, size := 48, color = null) -> Label:
	var l := Label.new()
	l.text = text
	l.theme_type_variation = "Title"
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_constant_override("outline_size", maxi(5, int(size * 0.12)))
	l.add_theme_constant_override("shadow_outline_size", maxi(5, int(size * 0.12)))
	var sh := maxi(3, int(size * 0.07))
	l.add_theme_constant_override("shadow_offset_x", sh)
	l.add_theme_constant_override("shadow_offset_y", sh)
	if color != null:
		l.add_theme_color_override("font_color", color)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l

static func hbox(sep := 12, align := BoxContainer.ALIGNMENT_BEGIN) -> HBoxContainer:
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", sep)
	h.alignment = align
	h.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return h

static func vbox(sep := 10, align := BoxContainer.ALIGNMENT_BEGIN) -> VBoxContainer:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", sep)
	v.alignment = align
	v.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return v

static func panel(kind := "PanelDark") -> PanelContainer:
	var p := PanelContainer.new()
	p.theme_type_variation = kind
	p.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return p

static func spacer(horizontal := true) -> Control:
	var c := Control.new()
	c.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if horizontal:
		c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	else:
		c.size_flags_vertical = Control.SIZE_EXPAND_FILL
	return c

static func gap(w := 0.0, h := 0.0) -> Control:
	var c := Control.new()
	c.custom_minimum_size = Vector2(w, h)
	c.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return c

static func margin(l := 0, t := 0, r := 0, b := 0) -> MarginContainer:
	var m := MarginContainer.new()
	m.add_theme_constant_override("margin_left", l)
	m.add_theme_constant_override("margin_top", t)
	m.add_theme_constant_override("margin_right", r)
	m.add_theme_constant_override("margin_bottom", b)
	m.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return m

static func clear(n: Node) -> void:
	for c in n.get_children():
		n.remove_child(c)
		c.queue_free()

## a texture drawn into a polygon window (invisible geometry: a textured Polygon2D whose UVs cover-fit the
## texture into `rect`, `focus_y` = vertical anchor of the crop 0..1). The web masks with Graphics; same result.
static func tex_window(tex: Texture2D, points: PackedVector2Array, rect: Rect2, focus_y := 0.5, focus_x := 0.5) -> Polygon2D:
	var p := Polygon2D.new()
	p.polygon = points
	if tex == null:
		p.visible = false
		return p
	p.texture = tex
	var ts := tex.get_size()
	var k := maxf(rect.size.x / ts.x, rect.size.y / ts.y)
	var off := Vector2(rect.position.x + (rect.size.x - ts.x * k) * focus_x, rect.position.y + (rect.size.y - ts.y * k) * focus_y)
	var uv := PackedVector2Array()
	for pt in points:
		uv.append((pt - off) / k)
	p.uv = uv
	return p

static func circle_points(c: Vector2, r: float, n := 40) -> PackedVector2Array:
	var pts := PackedVector2Array()
	for i in n:
		var a := TAU * i / n
		pts.append(c + Vector2(cos(a), sin(a)) * r)
	return pts

static func rect_points(r: Rect2) -> PackedVector2Array:
	return PackedVector2Array([r.position, Vector2(r.end.x, r.position.y), r.end, Vector2(r.position.x, r.end.y)])

## a circular hero portrait inside the skill-disc ring (top bar / lieutenant): `size` = ring size
static func portrait_disc(hero_id: String, size: float, ring_tint := Color.WHITE) -> Control:
	var c := Control.new()
	c.custom_minimum_size = Vector2(size, size)
	c.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var ring := Wb.sprite("skill_disc", Vector2(size, size) * 1.09, {"modulate": ring_tint})
	ring.position = -Vector2(size, size) * 0.045
	c.add_child(ring)
	var t := Assets.tex(K.hero(hero_id))
	if t != null:
		var r := size * 0.453
		var ctr := Vector2(size, size) / 2.0
		# face crop: width ≈ 55% of the art, anchored near the top (hud.ts)
		var ts := t.get_size()
		var k := size / (ts.x * 0.55)
		var off := Vector2(ctr.x - ts.x * k / 2.0, ctr.y - ts.y * k * 0.12 - size * 0.12)
		var p := Polygon2D.new()
		p.texture = t
		p.polygon = circle_points(ctr, r)
		var uv := PackedVector2Array()
		for pt in p.polygon:
			uv.append((pt - off) / k)
		p.uv = uv
		c.add_child(p)
	return c

## a floating message (toast() in widgets.ts); engine codes are translated first
static func toast(text: String, color := C.gold_light, y := 200.0) -> void:
	var layer := App.inst.toasts if App.inst else null
	if layer == null:
		return
	var p := PanelContainer.new()
	p.theme_type_variation = "PanelBanner"
	p.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var l := label(UiErrors.text(text), "NoteTitle", 30, color)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	p.add_child(l)
	layer.add_child(p)
	p.reset_size()
	var v := Layout.view
	p.position = Vector2(v.position.x + (v.size.x - p.size.x) / 2.0, v.position.y + y)
	p.modulate.a = 0.0
	var tw := p.create_tween()
	tw.tween_property(p, "modulate:a", 1.0, 0.18)
	tw.parallel().tween_property(p, "position:y", p.position.y - 10, 0.18)
	tw.tween_interval(1.1)
	tw.tween_property(p, "modulate:a", 0.0, 0.3)
	tw.parallel().tween_property(p, "position:y", p.position.y - 30, 0.3)
	tw.tween_callback(p.queue_free)

## a relic icon (texture from ui/relics) inside its disc
static func relic_disc(id: String, size: float) -> Control:
	var def = MqContent.relics.get(id)
	var c := Control.new()
	c.custom_minimum_size = Vector2(size, size)
	c.add_child(Wb.sprite("skill_disc_active" if def != null and def.tier == "boss" else "skill_disc", Vector2(size, size)))
	var ic := Wb.sprite(Assets.tex(K.relic(id)), Vector2(size, size) * 0.8)
	ic.position = Vector2(size, size) * 0.1
	c.add_child(ic)
	return c

## tooltip lines for a relic (title, text, flavour, glossary)
static func relic_lines(id: String) -> Array:
	var def: Dictionary = MqContent.relic(id)
	var out: Array = [{"title": def.name, "body": def.text, "color": Color8(0xff, 0x8a, 0x6a) if def.tier == "boss" else C.gold_light}]
	if def.get("flavor", "") != "":
		out.append({"body": def.flavor, "body_color": C.text_dim})
	out.append_array(UiGloss.lines(UiGloss.terms_of(def.text)))
	return out

static func potion_lines(id: String) -> Array:
	var def = MqContent.potions.get(id)
	if def == null:
		return []
	var out: Array = [{"title": def.name, "body": def.text}]
	out.append_array(UiGloss.lines(UiGloss.terms_of(def.text)))
	return out

## a hoverable / tappable Control wrapper (tooltips, taps); returns the control itself
static func tappable(c: Control, on_tap: Callable = Callable()) -> Control:
	c.mouse_filter = Control.MOUSE_FILTER_STOP
	if on_tap.is_valid():
		c.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		c.gui_input.connect(func(e: InputEvent):
			if e is InputEventMouseButton and not e.pressed and e.button_index == MOUSE_BUTTON_LEFT and c.get_global_rect().has_point(c.get_global_mouse_position()):
				on_tap.call())
	return c
