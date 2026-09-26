## Tooltips (port of Tooltip / showTip in src/game/ui/widgets.ts). A tip attaches to the control it explains: right of
## it, else left, else above / below, always clamped to the visible screen (Layout.view). Lines are
## [{title, body, color?}]; bodies are rules rich text (terms highlighted, {vars} / pips / suits rendered).
class_name Tip
extends RefCounted

static var layer: Control          # set by App (above modals)
static var _cur: Control = null
static var _owner: Control = null
static var _serial := 0
## every control with a tooltip attached (the UI tour hovers them)
static var anchors: Array = []

## show `lines` (Array or Callable returning an Array) whenever the pointer is over `c`
static func attach(c: Control, lines, width := 380.0, prefer := "right") -> void:
	if c.mouse_filter == Control.MOUSE_FILTER_IGNORE:
		c.mouse_filter = Control.MOUSE_FILTER_PASS
	c.mouse_entered.connect(func():
		var l = lines.call() if lines is Callable else lines
		show_for(c, l, width, prefer))
	c.mouse_exited.connect(func(): if _owner == c: hide())
	c.tree_exiting.connect(func():
		anchors.erase(c)
		if _owner == c: hide())
	anchors.append(c)

static func owner_is(c: Control) -> bool:
	return _owner == c

static func build(lines: Array, width: float) -> PanelContainer:
	var p := PanelContainer.new()
	p.theme_type_variation = "PanelTip"
	p.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var w := width * (1.4 if Layout.is_phone() else 1.0)
	p.custom_minimum_size = Vector2(w, 0)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 4)
	v.mouse_filter = Control.MOUSE_FILTER_IGNORE
	p.add_child(v)
	for l in lines:
		if l.get("title", "") != "":
			var t := Label.new()
			t.theme_type_variation = "TipTitle"
			t.text = l.title
			t.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			if l.has("color") and l.color != null:
				t.add_theme_color_override("font_color", l.color)
			v.add_child(t)
		if l.get("body", "") != "":
			var r := RichLabel.make(l.body, {"size": 18, "color": l.get("body_color", C.body_light), "term_color": C.term, "light": true})
			r.mouse_filter = Control.MOUSE_FILTER_IGNORE
			v.add_child(r)
	return p

static func show_for(anchor: Control, lines: Array, width := 380.0, prefer := "right") -> void:
	hide()
	if layer == null or lines.is_empty() or not is_instance_valid(anchor) or not anchor.is_inside_tree():
		return
	_serial += 1
	var serial := _serial
	var p := build(lines, width)
	p.modulate.a = 0.0
	layer.add_child(p)
	_cur = p
	_owner = anchor
	# rich text measures itself on the next frame
	await layer.get_tree().process_frame
	if serial != _serial or not is_instance_valid(p) or not is_instance_valid(anchor):
		return
	p.reset_size()
	place(p, anchor_rect(anchor), prefer)
	var tw := p.create_tween()
	tw.tween_property(p, "modulate:a", 1.0, 0.12)

## the anchor's visible rect in design (viewport canvas) units
static func anchor_rect(c: Control) -> Rect2:
	var xf := c.get_global_transform()
	return Rect2(xf.origin, c.size * xf.get_scale()).abs()

static func place(p: Control, a: Rect2, prefer: String) -> void:
	var v := Layout.view
	var b := p.size
	var gap := 14.0
	var tx: float
	var ty: float
	if a.size.x > 520 or a.size.y > 520:
		# huge hover zones: stay near the pointer
		var m := p.get_global_mouse_position()
		a = Rect2(m - Vector2(8, 8), Vector2(16, 16))
	var fits_r := a.end.x + gap + b.x <= v.end.x - 8
	var fits_l := a.position.x - gap - b.x >= v.position.x + 8
	if prefer != "above" and prefer != "below" and (fits_r or fits_l):
		if prefer == "left" and fits_l:
			tx = a.position.x - gap - b.x
		elif fits_r:
			tx = a.end.x + gap
		else:
			tx = a.position.x - gap - b.x
		ty = a.position.y + a.size.y / 2.0 - minf(b.y / 2.0, 60.0)
	else:
		tx = a.position.x + a.size.x / 2.0 - b.x / 2.0
		var above_ok := a.position.y - gap - b.y >= v.position.y + 8
		ty = a.position.y - gap - b.y if (above_ok and prefer != "below") or (prefer == "below" and a.end.y + gap + b.y > v.end.y - 8) else a.end.y + gap
	tx = clampf(tx, v.position.x + 8, maxf(v.position.x + 8, v.end.x - b.x - 8))
	ty = clampf(ty, v.position.y + 8, maxf(v.position.y + 8, v.end.y - b.y - 8))
	p.position = Vector2(tx, ty)

static func hide() -> void:
	_serial += 1
	if _cur != null and is_instance_valid(_cur):
		_cur.queue_free()
	_cur = null
	_owner = null

static func current() -> Control:
	return _cur if _cur != null and is_instance_valid(_cur) else null
