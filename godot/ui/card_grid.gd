## Scrollable grid of card views (cardGrid in src/game/ui/hud.ts). The column count follows the box width, so the
## grid fills any modal / screen size; `card_scale` comes from the variant scene (bigger cards on phones).
## Tapping a card calls on_pick(i, view) (default: inspect it); right click / long press inspects.
class_name CardGrid
extends WbScroll

@export var card_scale := 0.5
@export var gap := 18

var views: Array[CardView] = []
var on_pick: Callable
var on_hover: Callable
var _grid: GridContainer
var _wrap: VBoxContainer

func _init() -> void:
	super._init()
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	size_flags_vertical = Control.SIZE_EXPAND_FILL

func _ready() -> void:
	super._ready()
	_wrap = VBoxContainer.new()
	_wrap.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_wrap.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_wrap)
	_wrap.add_child(U.gap(0, 16))
	_grid = GridContainer.new()
	_grid.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	_grid.add_theme_constant_override("h_separation", gap)
	_grid.add_theme_constant_override("v_separation", gap)
	_grid.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_wrap.add_child(_grid)
	_wrap.add_child(U.gap(0, 16))
	resized.connect(_columns)

## cards: [{id, up, uid?}] (already sorted)
func set_cards(cards: Array) -> void:
	if _grid == null:
		await ready
	U.clear(_grid)
	views.clear()
	for i in cards.size():
		var c: Dictionary = cards[i]
		var v := CardView.make(c.id, c.get("up", false), card_scale, {}, c.get("uid", -1))
		if c.get("face_down", false):
			v.face_down = true
			v.hover_grow = false
			v.modulate.a = 0.5
			v.mouse_default_cursor_shape = Control.CURSOR_ARROW
		var idx: int = i
		v.pressed.connect(func():
			if on_pick.is_valid(): on_pick.call(idx, v)
			else: DeckView.inspect(c.id, c.get("up", false)))
		v.inspect.connect(func(): if not c.get("face_down", false): DeckView.inspect(c.id, c.get("up", false)))
		if on_hover.is_valid():
			v.hovered.connect(func(on: bool): on_hover.call(idx, v if on else null))
		_grid.add_child(v)
		views.append(v)
	_columns()

func _columns() -> void:
	if _grid == null:
		return
	var cw := CardView.W * card_scale
	_grid.columns = maxi(1, int(floor((size.x - 20.0 + gap) / (cw * 1.06 + gap))))
