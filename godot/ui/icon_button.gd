## Square icon plate (phone top bar, compact toolbars): the carved equip_slot frame with a generated icon and an
## optional count badge; lifts on hover, presses down. At least the touch minimum on the phone profile.
class_name IconButton
extends BaseButton

@export var icon_id := "": set = set_icon_id
@export var badge := "": set = set_badge
@export var min_size := Vector2(96, 96)
## tooltip line shown on hover (the plate has no text of its own)
@export var tip := ""

var _icon: TextureRect
var _badge: Label
var _frame: StyleBoxNine

func _init() -> void:
	focus_mode = Control.FOCUS_NONE
	mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	_icon = TextureRect.new()
	_icon.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_icon.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	_icon.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_icon, false, Node.INTERNAL_MODE_FRONT)
	_badge = Label.new()
	_badge.theme_type_variation = "Num"
	_badge.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_badge.vertical_alignment = VERTICAL_ALIGNMENT_BOTTOM
	_badge.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_badge, false, Node.INTERNAL_MODE_FRONT)
	mouse_entered.connect(func(): if not disabled: Audio.sfx("hover"))
	pressed.connect(func(): Audio.sfx("click"))

func _ready() -> void:
	var m := Layout.touch_min()
	custom_minimum_size = Vector2(maxf(min_size.x, m), maxf(min_size.y, m))
	_frame = Wb.nine("equip_slot")
	if tip != "":
		Tip.attach(self, [{"title": tip, "body": ""}], 200, "below")

func set_icon_id(v: String) -> void:
	icon_id = v
	_icon.texture = Wb.icon_tex(v) if v != "" else null

func set_badge(v: String) -> void:
	badge = v
	_badge.text = v

func _draw() -> void:
	var dm := get_draw_mode()
	var off := Vector2(2, 2) if dm == DRAW_PRESSED or dm == DRAW_HOVER_PRESSED else (Vector2(0, -2) if dm == DRAW_HOVER else Vector2.ZERO)
	if _frame != null:
		draw_style_box(_frame, Rect2(off, size))
	_icon.position = size * 0.14 + off
	_icon.size = size * 0.72
	_badge.position = Vector2(0, 0) + off
	_badge.size = size - Vector2(size.x * 0.1, size.y * 0.04)
	_badge.add_theme_font_size_override("font_size", int(size.y * 0.3))
