## Modal dialog (port of Modal in src/game/ui/widgets.ts): an ink-texture dim over the whole visible screen, a
## woodblock panel centred in it with an optional carved title and a ✕ plate, Esc / tapping the dim closes it.
## Callers fill `body` (a VBoxContainer that expands inside the panel's INSET).
## Sizes are given in desktop design units; on the phone profile a modal takes (nearly) the whole visible screen.
class_name Modal
extends Control

signal closed

static var layer: Control   # set by App

var body: VBoxContainer
var frame: Control
var closable := true
var on_close: Callable
var title_label: Label
var close_btn: WbButton

## o: title (String), closable (bool), dim (float), phone_full (bool, default true)
static func open(want: Vector2, o: Dictionary = {}) -> Modal:
	var m := Modal.new()
	m._build(want, o)
	layer.add_child(m)
	m.modulate.a = 0.0
	m.create_tween().tween_property(m, "modulate:a", 1.0, 0.16)
	return m

static func top() -> Modal:
	if layer == null:
		return null
	for i in range(layer.get_child_count() - 1, -1, -1):
		var c := layer.get_child(i)
		if c is Modal and not c.is_queued_for_deletion():
			return c
	return null

static func close_all() -> void:
	if layer == null:
		return
	for c in layer.get_children():
		if c is Modal:
			c.close(true)

func _build(want: Vector2, o: Dictionary) -> void:
	closable = o.get("closable", true)
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	var d := Wb.dim_rect(o.get("dim", 0.75))
	d.mouse_filter = Control.MOUSE_FILTER_STOP
	d.gui_input.connect(func(e: InputEvent):
		if closable and e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT:
			close())
	add_child(d)
	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(center)
	var v := Layout.view.size
	var size := want
	if Layout.is_phone() and o.get("phone_full", true):
		size = Vector2(maxf(want.x, v.x - 40), maxf(want.y, v.y - 24))
	size = Vector2(minf(size.x, v.x - 16), minf(size.y, v.y - 12))
	frame = Control.new()
	frame.custom_minimum_size = size
	frame.mouse_filter = Control.MOUSE_FILTER_STOP
	center.add_child(frame)
	var bg := Panel.new()
	bg.theme_type_variation = "PanelDarkBg"
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	frame.add_child(bg)
	var margin := MarginContainer.new()
	margin.set_anchors_preset(Control.PRESET_FULL_RECT)
	var inset: Vector2 = Wb.INSET.dark
	margin.add_theme_constant_override("margin_left", int(inset.x))
	margin.add_theme_constant_override("margin_right", int(inset.x))
	margin.add_theme_constant_override("margin_top", int(inset.y - 18) if o.has("title") else int(inset.y))
	margin.add_theme_constant_override("margin_bottom", int(inset.y))
	margin.mouse_filter = Control.MOUSE_FILTER_IGNORE
	frame.add_child(margin)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 14)
	col.mouse_filter = Control.MOUSE_FILTER_IGNORE
	margin.add_child(col)
	if o.get("title", "") != "":
		title_label = U.title(o.title, 40 if not Layout.is_phone() else 46)
		title_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		# keep the title clear of the ✕ plate
		title_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		title_label.clip_text = false
		col.add_child(title_label)
	body = VBoxContainer.new()
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.add_theme_constant_override("separation", 14)
	body.mouse_filter = Control.MOUSE_FILTER_IGNORE
	col.add_child(body)
	if closable:
		var bs := 56.0
		close_btn = WbButton.make("×", "ghost", Vector2(bs, bs), 28, close)
		var cs := close_btn.custom_minimum_size
		close_btn.anchor_left = 1.0
		close_btn.anchor_right = 1.0
		close_btn.offset_left = -cs.x - 14
		close_btn.offset_right = -14
		close_btn.offset_top = 14
		close_btn.offset_bottom = 14 + cs.y
		frame.add_child(close_btn)

func _unhandled_input(e: InputEvent) -> void:
	if e.is_action_pressed("ui_cancel") and closable and Modal.top() == self:
		get_viewport().set_input_as_handled()
		close()

func close(silent := false) -> void:
	if is_queued_for_deletion():
		return
	Tip.hide()
	if on_close.is_valid() and not silent:
		on_close.call()
	closed.emit()
	queue_free()

## add a row of buttons centred at the bottom of the body
func buttons(list: Array) -> HBoxContainer:
	var h := HBoxContainer.new()
	h.alignment = BoxContainer.ALIGNMENT_CENTER
	h.add_theme_constant_override("separation", 40)
	for b in list:
		h.add_child(b)
	body.add_child(h)
	return h
