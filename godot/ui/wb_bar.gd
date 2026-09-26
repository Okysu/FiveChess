## Gauge (port of Bar in src/game/ui/skin.ts): carved frame + stretched fill + optional ghost (preview) segment.
## The fill is the bar_fill_* texture clipped to the value (rect clip = invisible geometry). set_value(frac, ghost).
class_name WbBar
extends Control

@export_enum("red", "blue", "gold") var color := "red"
var frac := 1.0
var ghost := 0.0
var _fill_clip: Control
var _ghost_clip: Control
var _fill: Panel
var _ghost: Panel
var _frame: Panel

func _init() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_ghost_clip = _clip()
	_ghost = _panel(_ghost_clip)
	_fill_clip = _clip()
	_fill = _panel(_fill_clip)
	_frame = Panel.new()
	_frame.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_frame, false, Node.INTERNAL_MODE_FRONT)
	resized.connect(_layout)

func _ready() -> void:
	_styles()
	_layout()

func _clip() -> Control:
	var c := Control.new()
	c.clip_contents = true
	c.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(c, false, Node.INTERNAL_MODE_FRONT)
	return c

func _panel(parent: Control) -> Panel:
	var p := Panel.new()
	p.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(p)
	return p

func _styles() -> void:
	_fill.add_theme_stylebox_override("panel", Wb.nine("bar_fill_" + color))
	_ghost.add_theme_stylebox_override("panel", Wb.nine("bar_fill_gold", {"modulate": Color(1, 1, 1, 0.75)}))
	_frame.add_theme_stylebox_override("panel", Wb.nine("bar_frame"))

func set_color(c: String) -> void:
	color = c
	if is_inside_tree():
		_styles()

func set_value(f: float, g := 0.0) -> void:
	frac = clampf(f, 0.0, 1.0)
	ghost = clampf(g, 0.0, frac)
	_layout()

func _layout() -> void:
	var inset := maxf(3.0, size.y * 0.22)
	var inner := Vector2(maxf(0.0, size.x - inset * 2.0), maxf(0.0, size.y - inset * 2.0))
	_frame.position = Vector2.ZERO
	_frame.size = size
	for p in [_fill, _ghost]:
		p.position = Vector2.ZERO
		p.size = inner
	# fill: [0, frac-ghost]; ghost: [frac-ghost, frac] (in frame width like the web)
	var fw := size.x * (frac - ghost)
	_fill_clip.position = Vector2(inset, inset)
	_fill_clip.size = Vector2(clampf(fw - inset, 0.0, inner.x), inner.y)
	_ghost_clip.position = Vector2(inset + maxf(0.0, fw - inset), inset)
	_ghost.position = Vector2(-maxf(0.0, fw - inset), 0)
	_ghost_clip.size = Vector2(clampf(size.x * ghost, 0.0, inner.x), inner.y)
