## Woodblock button (port of Button in src/game/ui/widgets.ts): a printed plate texture (9-slice) per kind
## (primary / normal / ghost / danger, grey when disabled) over its ink-black print layer; pressing shifts the plate onto
## the shadow, hovering lifts it. The label is fitted inside the plate face (the cloud-scroll ends take ~20% per side).
## Works in containers: its minimum size is `min_size` (on the phone profile at least the 48 dp touch target).
class_name WbButton
extends BaseButton

@export var text := "": set = set_text
@export var sub := "": set = set_sub
@export_enum("primary", "normal", "ghost", "danger") var kind := "normal": set = set_kind
@export var font_size := 30: set = set_font_size
@export var min_size := Vector2(240, 72): set = set_min_size
## pulsing gold frame (the "do this next" hint)
@export var pulse := false

var _lbl: Label
var _sub: Label
var _t := 0.0
var _styles := {}

func _init() -> void:
	focus_mode = Control.FOCUS_NONE
	mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	_lbl = Label.new()
	_lbl.theme_type_variation = "BtnLabel"
	_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_lbl.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_lbl.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_lbl, false, Node.INTERNAL_MODE_FRONT)
	_sub = Label.new()
	_sub.theme_type_variation = "BtnSub"
	_sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_sub.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_sub.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_sub.visible = false
	add_child(_sub, false, Node.INTERNAL_MODE_FRONT)
	resized.connect(_fit)
	mouse_entered.connect(_on_enter)
	gui_input.connect(_on_input)

static func make(t: String, k := "normal", size := Vector2(240, 72), fsize := 30, on_press: Callable = Callable()) -> WbButton:
	var b := WbButton.new()
	b.kind = k
	b.min_size = size
	b.font_size = fsize
	b.text = t
	if on_press.is_valid():
		b.pressed.connect(on_press)
	return b

func _ready() -> void:
	_apply_min()
	_fit()

func set_text(v: String) -> void:
	text = v
	if _lbl:
		_lbl.text = v
		_fit()

func set_sub(v: String) -> void:
	sub = v
	if _sub:
		_sub.text = v
		_sub.visible = v != ""
		_fit()

func set_kind(v: String) -> void:
	kind = v
	queue_redraw()

func set_font_size(v: int) -> void:
	font_size = v
	_fit()

func set_min_size(v: Vector2) -> void:
	min_size = v
	_apply_min()

func _apply_min() -> void:
	var m := Layout.touch_min()
	custom_minimum_size = Vector2(maxf(min_size.x, m), maxf(min_size.y, m))

func _notification(what: int) -> void:
	if what == NOTIFICATION_ENTER_TREE:
		_apply_min()
	elif what == NOTIFICATION_THEME_CHANGED:
		_fit()

func _style(key: String, shadow: bool) -> StyleBoxNine:
	var k := key + ("_s" if shadow else "")
	if not _styles.has(k):
		_styles[k] = Wb.nine(key, {"modulate": Color(C.wb_ink, 0.8)} if shadow else {})
	return _styles[k]

func _draw() -> void:
	var dm := get_draw_mode()
	var dis := disabled
	var key: String = Wb.PLATE["disabled" if dis else kind]
	var down := dm == DRAW_PRESSED or dm == DRAW_HOVER_PRESSED
	var off := Vector2(3, 3) if down and not dis else (Vector2(0, -2) if dm == DRAW_HOVER and not dis else Vector2.ZERO)
	var r := Rect2(Vector2.ZERO, size)
	if pulse:
		var f := _style("frame_gold", false)
		f.expand = 8.0
		f.modulate = Color(1, 1, 1, 0.5 + 0.5 * sin(_t * 1000.0 / 260.0))
		draw_style_box(f, r)
	draw_style_box(_style(key, true), Rect2(r.position + Vector2(4, 5), r.size))
	draw_style_box(_style(key, false), Rect2(r.position + off, r.size))
	_place(off)
	_lbl.add_theme_color_override("font_color", Color8(0xc8, 0xbc, 0xa8) if dis else C.wb_white)

func _place(off: Vector2) -> void:
	var has_sub := _sub.visible
	var lh := size.y * (0.62 if not has_sub else 0.5)
	_lbl.position = Vector2(0, (size.y * 0.4 - lh / 2.0) if has_sub else (size.y - lh) / 2.0) + off
	_lbl.size = Vector2(size.x, lh)
	if has_sub:
		_sub.position = Vector2(0, size.y * 0.72 - size.y * 0.15) + off
		_sub.size = Vector2(size.x, size.y * 0.3)

## keep the label inside the plate face
func _fit() -> void:
	if _lbl == null:
		return
	var fsz := Layout.fs(font_size)
	var w := size.x if size.x > 0 else custom_minimum_size.x
	var h := size.y if size.y > 0 else custom_minimum_size.y
	var max_w := maxf(w * 0.4, minf(w * 0.62, w - h * 1.15))
	var max_h := h * (0.42 if _sub.visible else 0.62)
	var f := _lbl.get_theme_font("font")
	var s := fsz
	if f != null and text != "":
		while s > 10:
			var ts := f.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, s)
			if ts.x <= max_w and ts.y * 0.8 <= max_h:
				break
			s -= 1
	_lbl.add_theme_font_size_override("font_size", s)
	_sub.add_theme_font_size_override("font_size", Layout.fs(15))
	queue_redraw()

func _process(delta: float) -> void:
	if pulse:
		_t += delta
		queue_redraw()

func _on_enter() -> void:
	if not disabled:
		Audio.sfx("hover")

func _on_input(e: InputEvent) -> void:
	if e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT:
		if disabled:
			Audio.sfx("deny")
		else:
			Audio.sfx("click")
