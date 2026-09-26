## ScrollContainer with drag-to-scroll for mouse and touch (the map and card grids scroll by dragging, like the web
## ScrollBox), wheel scrolling (horizontal boxes scroll on the vertical wheel too), and a slider_knob texture as the
## position indicator instead of a procedural scroll bar. Children check `WbScroll.was_drag()` before treating a
## release as a tap.
class_name WbScroll
extends ScrollContainer

static var _dragged := false

@export var horizontal := false

var _down := false
var _start := Vector2.ZERO
var _start_scroll := Vector2.ZERO
var _moved := 0.0
var _knob: TextureRect

static func was_drag() -> bool:
	return _dragged

func _init() -> void:
	vertical_scroll_mode = ScrollContainer.SCROLL_MODE_SHOW_NEVER
	horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_SHOW_NEVER
	scroll_deadzone = 8

func _ready() -> void:
	if horizontal:
		vertical_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	else:
		horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_knob = TextureRect.new()
	_knob.texture = Wb.tex("slider_knob")
	_knob.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_knob.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	_knob.size = Vector2(22, 22) * (1.6 if Layout.is_phone() else 1.0)
	_knob.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_knob, false, Node.INTERNAL_MODE_FRONT)
	get_h_scroll_bar().value_changed.connect(func(_v): _place_knob())
	get_v_scroll_bar().value_changed.connect(func(_v): _place_knob())
	get_h_scroll_bar().changed.connect(_place_knob)
	get_v_scroll_bar().changed.connect(_place_knob)
	resized.connect(_place_knob)
	_place_knob.call_deferred()

func _place_knob() -> void:
	if _knob == null:
		return
	var bar: ScrollBar = get_h_scroll_bar() if horizontal else get_v_scroll_bar()
	var mx := bar.max_value - bar.page
	_knob.visible = mx > 1.0
	if not _knob.visible:
		return
	var k := clampf(bar.value / mx, 0.0, 1.0)
	var ks := _knob.size
	if horizontal:
		_knob.position = Vector2(12 + k * (size.x - 24) - ks.x / 2.0, size.y - 12 - ks.y / 2.0)
	else:
		_knob.position = Vector2(size.x - 12 - ks.x / 2.0, 12 + k * (size.y - 24) - ks.y / 2.0)

func _input(e: InputEvent) -> void:
	if not is_visible_in_tree():
		return
	if e is InputEventMouseButton and e.button_index == MOUSE_BUTTON_LEFT:
		if e.pressed:
			if _over_me(e.position):
				_down = true
				_dragged = false
				_moved = 0.0
				_start = e.position
				_start_scroll = Vector2(scroll_horizontal, scroll_vertical)
		elif _down:
			_down = false
			if _dragged:
				_reset_later()
	elif e is InputEventMouseMotion and _down:
		var d: Vector2 = (_start - e.position) / get_global_transform_with_canvas().get_scale()
		_moved = maxf(_moved, d.length())
		if _moved > 8.0:
			_dragged = true
			if horizontal:
				scroll_horizontal = int(_start_scroll.x + d.x)
			else:
				scroll_vertical = int(_start_scroll.y + d.y)
	if e is InputEventMouseButton and e.pressed and (e.button_index == MOUSE_BUTTON_WHEEL_DOWN or e.button_index == MOUSE_BUTTON_WHEEL_UP) and _over_me(e.position):
		var step := 90 if e.button_index == MOUSE_BUTTON_WHEEL_DOWN else -90
		if horizontal:
			scroll_horizontal += step
		else:
			scroll_vertical += step
		get_viewport().set_input_as_handled()

func _reset_later() -> void:
	await get_tree().process_frame
	_dragged = false

## true when the point is over this box and not covered by a modal / something outside it
func _over_me(p: Vector2) -> bool:
	if not get_global_rect().has_point(p):
		return false
	var h := get_viewport().gui_get_hovered_control()
	return h == null or h == self or is_ancestor_of(h)
