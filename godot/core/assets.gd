## Asset store (port of src/game/assets.ts): resolves generated art / audio from res://assets/manifest.json and
## lazy-loads textures by the same keys as the web version ("cards/R/r_x", "ui/panel_dark", "heroes/r_huojin" …;
## key = manifest path without extension). Build keys with the static helpers in K (core/k.gd).
## The packed atlases of the web build are not used: every frame also exists as its own file.
extends Node

const ROOT := "res://assets/"

var entries: Array = []
var _by_key := {}      # key -> res:// path
var _tex := {}         # key -> Texture2D
var _missing := {}     # keys that failed to load (logged once)

func _ready() -> void:
	_read_manifest()

func _read_manifest() -> void:
	if not _by_key.is_empty():
		return
	var f := FileAccess.open(ROOT + "manifest.json", FileAccess.READ)
	if f == null:
		push_warning("assets: no manifest.json (run npx tsx scripts/sync-godot-assets.ts)")
		return
	var j = JSON.parse_string(f.get_as_text())
	if j is Dictionary:
		entries = j.get("assets", [])
		for a in entries:
			var p: String = a.path
			_by_key[p.get_basename()] = ROOT + p

func has(key: String) -> bool:
	return _by_key.has(key)

func path_of(key: String) -> String:
	return _by_key.get(key, "")

## the texture for a key, or null when the asset does not exist (callers show nothing: no procedural fallback)
func tex(key: String) -> Texture2D:
	var t = _tex.get(key)
	if t != null:
		return t
	var p: String = _by_key.get(key, "")
	if p == "" or _missing.has(key):
		return null
	var r = load(p)
	if r is Texture2D:
		_tex[key] = r
		return r
	_missing[key] = true
	push_warning("assets: cannot load %s" % p)
	return null

func is_loaded(key: String) -> bool:
	return _tex.has(key)

## preload a list of keys over several frames; progress(k) is called with 0..1
func load_many(keys: Array, progress: Callable = Callable()) -> void:
	var list: Array = []
	for k in keys:
		if _by_key.has(k) and not _tex.has(k) and not list.has(k):
			list.append(k)
	if list.is_empty():
		if progress.is_valid():
			progress.call(1.0)
		return
	for k in list:
		ResourceLoader.load_threaded_request(_by_key[k], "Texture2D")
	var done := 0
	var pending := list.duplicate()
	while not pending.is_empty():
		for k in pending.duplicate():
			var st := ResourceLoader.load_threaded_get_status(_by_key[k])
			if st == ResourceLoader.THREAD_LOAD_IN_PROGRESS:
				continue
			pending.erase(k)
			done += 1
			if st == ResourceLoader.THREAD_LOAD_LOADED:
				var r = ResourceLoader.load_threaded_get(_by_key[k])
				if r is Texture2D:
					_tex[k] = r
			else:
				_missing[k] = true
		if progress.is_valid():
			progress.call(float(done) / list.size())
		if not pending.is_empty():
			await get_tree().process_frame

func keys_by_prefix(prefix: String) -> Array:
	var out: Array = []
	for k in _by_key:
		if String(k).begins_with(prefix):
			out.append(k)
	return out

## a JSON file shipped with the assets (credits.json, audio/audio.json) or the content data (res://data/…)
func read_json(path: String):
	if not FileAccess.file_exists(path):
		return null
	return MqU.read_json(path)
