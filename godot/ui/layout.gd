## Layout profile (port of src/game/ui/profile.ts + the profile part of core/app.ts layout()).
##
## The project stretches with mode canvas_items / aspect expand from a 1920×1080 base: a window that is not 16:9
## gets EXTRA design space at its edges (never black bars). `view` is that visible design rect; screens are built
## from anchors and containers, so they fill whatever it is.
##
## Profile 'desktop' | 'phone' is decided at startup and whenever the window size changes:
##   · forced by the command line (`-- --profile=phone|desktop`) or the 布局 setting (Session.settings.profile), else
##   · 'phone' on a mobile OS whose screen's shorter side is small (< 4.6 inches, from DisplayServer size / dpi), or
##     when the window shows the design below 0.55× (text would be tiny, same threshold as the web version).
## Phone screens are different scene variants (scenes/phone/*.tscn): bigger type (fs()), touch targets of at least
## 48 dp (touch_min()), fewer columns and bigger cards. A profile flip rebuilds the current screen (App listens).
extends Node

signal profile_changed(profile: String)
signal view_changed

const DESIGN := Vector2(1920, 1080)

var profile := "desktop"
var view := Rect2(Vector2.ZERO, DESIGN)
## "" = automatic; set from the command line or the settings
var cmd_forced := ""
var setting_forced := ""
var _ready_done := false

func _ready() -> void:
	for a in OS.get_cmdline_user_args() + OS.get_cmdline_args():
		if String(a).begins_with("--profile="):
			var p := String(a).trim_prefix("--profile=")
			if p == "phone" or p == "desktop":
				cmd_forced = p
	get_tree().root.size_changed.connect(_on_size)
	_update(false)
	_ready_done = true

func is_phone() -> bool:
	return profile == "phone"

## the 布局 setting ("auto" | "desktop" | "phone")
func set_override(p: String) -> void:
	setting_forced = "" if p == "auto" else p
	_update(true)

func _on_size() -> void:
	_update(true)

func _update(emit: bool) -> void:
	var vr := get_tree().root.get_visible_rect()
	var changed_view := absf(vr.size.x - view.size.x) > 1.0 or absf(vr.size.y - view.size.y) > 1.0
	view = vr
	var next := _pick()
	if next != profile:
		profile = next
		if emit:
			profile_changed.emit(profile)
	elif changed_view and emit:
		view_changed.emit()

func _pick() -> String:
	if cmd_forced != "":
		return cmd_forced
	if setting_forced != "":
		return setting_forced
	var win := DisplayServer.window_get_size()
	if OS.has_feature("mobile"):
		var scr := DisplayServer.screen_get_size()
		var dpi := maxf(1.0, DisplayServer.screen_get_dpi())
		if minf(scr.x, scr.y) / dpi < 4.6:
			return "phone"
	if win.x > 0 and win.y > 0 and minf(win.x / DESIGN.x, win.y / DESIGN.y) < 0.55:
		return "phone"
	return "desktop"

## font size for the active profile — every UI font size goes through here (web profile.ts fs()).
## Small text grows the most on phones; big titles stay as they are.
func fs(n: float) -> int:
	if profile == "desktop":
		return int(round(n))
	var k := 1.6 if n <= 16 else 1.45 if n <= 22 else 1.3 if n <= 30 else 1.15 if n <= 44 else 1.0
	return int(round(n * k))

## design units per density-independent pixel. On a real phone this comes from the screen dpi; when the phone
## profile is forced on a desktop, a landscape phone of 400 dp height is assumed.
func units_per_dp() -> float:
	var vis_h := view.size.y
	if OS.has_feature("mobile"):
		var win := DisplayServer.window_get_size()
		var dpi := maxf(1.0, DisplayServer.screen_get_dpi())
		var dp_h := win.y / (dpi / 160.0)
		if dp_h > 1.0:
			return vis_h / dp_h
	return vis_h / 400.0

## minimum size of anything tappable on the phone profile (48 dp); 0 on desktop
func touch_min() -> float:
	return ceilf(48.0 * units_per_dp()) if profile == "phone" else 0.0

## a size that is at least the touch minimum on phones
func tap(n: float) -> float:
	return maxf(n, touch_min())

## the scene variant directory for the active profile
func scene_dir() -> String:
	return "res://scenes/%s/" % profile
