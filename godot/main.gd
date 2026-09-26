## App shell (port of GameApp in src/game/core/app.ts): full-screen backdrop, the screen host, modal / tooltip /
## toast layers and the ink transition curtain, all anchored to the visible screen (canvas_items + expand stretch,
## so non-16:9 windows get extra room at the edges instead of black bars).
## Screens are scene variants: `show(name)` instantiates res://scenes/<profile>/<name>.tscn. When the layout profile
## flips (Layout.profile_changed) the theme is rebuilt and the current screen is re-created in the new variant.
class_name App
extends Control

static var inst: App

@onready var backdrop: TextureRect = $Backdrop
@onready var host: Control = $Screen
@onready var modals: Control = $Modals
@onready var tips: Control = $Tips
@onready var toasts: Control = $Toasts
@onready var fade: TextureRect = $Fade

var screen: Screen = null
var screen_name := ""
var screen_params := {}
var _switching := false
var _queued: Array = []

func _ready() -> void:
	inst = self
	Modal.layer = modals
	Tip.layer = tips
	get_tree().root.theme = UiTheme.build()
	Layout.profile_changed.connect(_on_profile)
	fade.texture = Wb.tex("dim_vignette")
	fade.modulate = Color(0, 0, 0, 1)
	fade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if "--tour" in OS.get_cmdline_user_args():
		add_child(load("res://tests/ui_tour.gd").new())
	show_screen("boot", {}, 0.0)
	_dev_shot()

## switch to a screen (fades through the ink curtain). Calls made during a switch run after it.
func show_screen(name: String, params := {}, fade_time := 0.28) -> void:
	if _switching:
		_queued = [name, params]
		return
	_switching = true
	Tip.hide()
	if fade_time > 0.0 and screen != null:
		fade.mouse_filter = Control.MOUSE_FILTER_STOP
		var tw := create_tween()
		tw.tween_property(fade, "modulate:a", 1.0, fade_time)
		await tw.finished
	else:
		fade.modulate.a = 1.0
	if screen != null:
		screen.exit()
		host.remove_child(screen)
		screen.queue_free()
		screen = null
	Modal.close_all()
	for t in toasts.get_children():
		t.queue_free()
	var path := Layout.scene_dir() + name + ".tscn"
	var packed: PackedScene = load(path)
	var s: Screen = packed.instantiate()
	s.params = params
	screen = s
	screen_name = name
	screen_params = params
	host.add_child(s)
	await s.enter()
	var tw2 := create_tween()
	tw2.tween_property(fade, "modulate:a", 0.0, maxf(fade_time, 0.2))
	await tw2.finished
	fade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_switching = false
	if _queued.size() > 0:
		var q := _queued
		_queued = []
		show_screen(q[0], q[1])
		return
	if screen == s and is_instance_valid(s):
		s.shown()

func is_switching() -> bool:
	return _switching

## full-screen backdrop texture (cover-fit behind everything, at any aspect)
func set_backdrop(key: String, tint := Color.WHITE) -> void:
	backdrop.texture = Assets.tex(key) if key != "" else null
	backdrop.modulate = tint

func _on_profile(_p: String) -> void:
	get_tree().root.theme = UiTheme.build()
	if screen_name != "" and screen_name != "boot":
		show_screen(screen_name, screen_params, 0.15)

func _unhandled_input(e: InputEvent) -> void:
	if e.is_action_pressed("ui_cancel") and Modal.top() == null and screen != null and not _switching:
		if not screen.on_back() and Session.run != null and screen_name != "title":
			get_viewport().set_input_as_handled()
			Settings.open()

## dev: `-- --shot=path.png [--wait=4]` saves a screenshot after a delay and quits (smoke runs)
func _dev_shot() -> void:
	var path := ""
	var wait := 4.0
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--shot="):
			path = a.trim_prefix("--shot=")
		elif a.begins_with("--wait="):
			wait = float(a.trim_prefix("--wait="))
	if path == "":
		return
	await get_tree().create_timer(wait).timeout
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(path)
	print("shot saved: ", path)
	get_tree().quit()
