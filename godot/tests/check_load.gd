## Loads every UI script and scene (compile / parse check for the game layer).
##   godot --headless --path godot --script res://tests/check_load.gd
extends SceneTree

func _initialize() -> void:
	var bad := 0
	for dir in ["res://core", "res://ui", "res://screens", "res://scenes/desktop", "res://scenes/phone", "res://tests"]:
		for f in _files(dir):
			if f.ends_with("check_load.gd") or not (f.ends_with(".gd") or f.ends_with(".tscn")):
				continue
			var r = ResourceLoader.load(f, "", ResourceLoader.CACHE_MODE_IGNORE)
			if r == null:
				bad += 1
				printerr("FAILED ", f)
			elif (r is PackedScene or r is Script) and not r.can_instantiate():
				bad += 1
				printerr("CANNOT INSTANTIATE ", f)
	print("check_load: %d failures" % bad)
	quit(1 if bad > 0 else 0)

func _files(dir: String) -> Array:
	var out: Array = []
	var d := DirAccess.open(dir)
	if d == null:
		return out
	for f in d.get_files():
		out.append(dir + "/" + f)
	for sub in d.get_directories():
		out.append_array(_files(dir + "/" + sub))
	return out
