## 9-slice of a generated woodblock texture with SCALED corners — the Godot counterpart of nine() in
## src/game/ui/skin.ts. StyleBoxTexture draws corners at source-pixel size; the generated plates are large
## (a 1024 px panel has ~200 px corners), so the slice is drawn under a scale transform k = corner / L, clamped so the
## corners never exceed the box (k ≤ w·0.92/(L+R), h·0.98/(T+B)), exactly like the web renderer.
## Used for every panel / button plate / frame / ribbon / bar in the theme and in widgets. An optional `shadow`
## draws the same plate inked black underneath at an offset (the woodblock print layer of buttons).
@tool
class_name StyleBoxNine
extends StyleBox

@export var texture: Texture2D
## slice margins as fractions of the texture size (SLICES in skin.ts)
@export var slice_l := 0.2
@export var slice_r := 0.2
@export var slice_t := 0.2
@export var slice_b := 0.2
## on-screen size of the left corner in design units (before clamping)
@export var corner := 24.0
@export var modulate := Color(1, 1, 1, 1)
@export var draw_center := true
@export var shadow := false
@export var shadow_offset := Vector2(4, 5)
@export var shadow_color := Color(0.106, 0.082, 0.071, 0.8)
## extra offset of the plate itself (pressed / hovered buttons)
@export var offset := Vector2.ZERO
## grow the drawn rect beyond the control rect (selection frames drawn outside their box)
@export var expand := 0.0

func _draw(to_canvas_item: RID, rect: Rect2) -> void:
	if texture == null:
		return
	if expand != 0.0:
		rect = rect.grow(expand)
	if shadow:
		_nine(to_canvas_item, Rect2(rect.position + shadow_offset, rect.size), shadow_color)
	_nine(to_canvas_item, Rect2(rect.position + offset, rect.size), modulate)

func _nine(ci: RID, rect: Rect2, col: Color) -> void:
	if rect.size.x < 1.0 or rect.size.y < 1.0:
		return
	var ts := texture.get_size()
	var L := ts.x * slice_l
	var R := ts.x * slice_r
	var T := ts.y * slice_t
	var B := ts.y * slice_b
	var k := corner / maxf(1.0, L)
	k = minf(k, minf(rect.size.x * 0.92 / maxf(1.0, L + R), rect.size.y * 0.98 / maxf(1.0, T + B)))
	if k <= 0.0:
		return
	var size := Vector2(maxf(L + R, rect.size.x / k), maxf(T + B, rect.size.y / k))
	RenderingServer.canvas_item_add_set_transform(ci, Transform2D(0.0, Vector2(k, k), 0.0, rect.position))
	RenderingServer.canvas_item_add_nine_patch(ci, Rect2(Vector2.ZERO, size), Rect2(Vector2.ZERO, ts), texture.get_rid(),
		Vector2(L, T), Vector2(R, B), RenderingServer.NINE_PATCH_STRETCH, RenderingServer.NINE_PATCH_STRETCH, draw_center, col)
	RenderingServer.canvas_item_add_set_transform(ci, Transform2D.IDENTITY)
