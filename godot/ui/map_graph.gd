## The map's node canvas: its own coordinate space inside the horizontal scroll (nodes are children positioned in it),
## plus the ink paths drawn as rows of generated path_dot textures (dashed() in map.ts): unwalked paths are small
## faded dots, walked ones dense vermilion dots.
class_name MapGraph
extends Control

var dots: Array = []   # [pos, size, walked, alpha]

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_PASS

func dashed(a: Vector2, b: Vector2, walked: bool, alpha := -1.0) -> void:
	var w := 6.0 if walked else 3.0
	var al := alpha if alpha >= 0.0 else (1.0 if walked else 0.55)
	var dash := not walked
	var step := 22.0 if dash else 11.0
	var n := maxi(1, int(floor(a.distance_to(b) / step)))
	for i in range(1, n):
		dots.append([a.lerp(b, float(i) / n), w * 2.4, dash, al])

func _draw() -> void:
	var t_dash := Wb.tex("path_dot")
	var t_walk := Wb.tex("path_dot_red")
	for d in dots:
		var t: Texture2D = t_dash if d[2] else t_walk
		if t == null:
			continue
		var s: float = d[1]
		draw_texture_rect(t, Rect2(d[0] - Vector2(s, s) / 2.0, Vector2(s, s)), false, Color(1, 1, 1, d[3]))
