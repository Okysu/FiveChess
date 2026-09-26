## Ambient drifting motes (Particles.ambient in src/game/fx/fx.ts): embers rising, petals falling, dust / stars
## hovering, ink smoke — CPUParticles2D emitting the generated effect textures (assets/effects), over the whole
## control rect (so it covers any window shape).
class_name Ambient
extends Control

@export_enum("embers", "petals", "dust", "stars", "ink") var kind := "dust"
@export var rate := 0.5

var _p: CPUParticles2D

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_p = CPUParticles2D.new()
	var fx := {"embers": "ember", "petals": "petal", "ink": "smoke"}.get(kind, "glow")
	_p.texture = Assets.tex(K.fx(fx))
	if _p.texture == null:
		return
	var tex_w := maxf(1.0, _p.texture.get_width())
	_p.amount = int(clampf(rate * 80.0, 8.0, 120.0))
	_p.lifetime = 7.0
	_p.preprocess = 6.0
	_p.emission_shape = CPUParticles2D.EMISSION_SHAPE_RECTANGLE
	_p.spread = 25.0
	_p.gravity = Vector2.ZERO
	var base := 64.0 / tex_w
	match kind:
		"embers":
			_p.direction = Vector2(0, -1)
			_p.initial_velocity_min = 40.0
			_p.initial_velocity_max = 90.0
			_p.scale_amount_min = 0.1 * base
			_p.scale_amount_max = 0.25 * base
			var m := CanvasItemMaterial.new()
			m.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
			_p.material = m
		"petals":
			_p.direction = Vector2(0.3, 1)
			_p.initial_velocity_min = 10.0
			_p.initial_velocity_max = 40.0
			_p.angular_velocity_min = -170.0
			_p.angular_velocity_max = 170.0
			_p.scale_amount_min = 0.08 * base
			_p.scale_amount_max = 0.16 * base
		"ink":
			_p.direction = Vector2(0, 1)
			_p.initial_velocity_min = 10.0
			_p.initial_velocity_max = 30.0
			_p.scale_amount_min = 0.1 * base
			_p.scale_amount_max = 0.2 * base
			_p.color = Color8(0x22, 0x22, 0x22, 0xb0)
		_:
			_p.direction = Vector2(0, 1)
			_p.initial_velocity_min = 5.0
			_p.initial_velocity_max = 25.0
			_p.scale_amount_min = 0.08 * base
			_p.scale_amount_max = 0.2 * base
			_p.color = Color8(0xff, 0xf4, 0xc8) if kind == "stars" else Color8(0xe8, 0xd8, 0xc0)
			var m2 := CanvasItemMaterial.new()
			m2.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
			_p.material = m2
	var ramp := Gradient.new()
	ramp.set_color(0, Color(1, 1, 1, 0))
	ramp.add_point(0.2, Color(1, 1, 1, 1))
	ramp.add_point(0.75, Color(1, 1, 1, 0.8))
	ramp.set_color(ramp.get_point_count() - 1, Color(1, 1, 1, 0))
	_p.color_ramp = ramp
	add_child(_p)
	resized.connect(_fit)
	_fit()

func _fit() -> void:
	if _p == null:
		return
	var y := size.y + 20.0 if kind == "embers" else (-20.0 if kind == "petals" else size.y / 2.0)
	var h := 10.0 if kind == "embers" or kind == "petals" else size.y / 2.0
	_p.position = Vector2(size.x / 2.0, y)
	_p.emission_rect_extents = Vector2(size.x / 2.0, h)
