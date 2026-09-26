## 鸣谢 (title.ts credits()): generated from assets/manifest.json by `npm run credits` (assets/credits.json).
## Body variant: scenes/<profile>/credits.tscn.
class_name Credits
extends Control

static func open() -> Modal:
	var m := Modal.open(Vector2(1300, 880), {"title": "制作与鸣谢"})
	var b: Control = load(Layout.scene_dir() + "credits.tscn").instantiate()
	b.size_flags_vertical = Control.SIZE_EXPAND_FILL
	m.body.add_child(b)
	return m

func _ready() -> void:
	var list := %List as VBoxContainer
	var j = Assets.read_json("res://assets/credits.json")
	if not (j is Dictionary):
		return
	for sec in j.get("sections", []):
		list.add_child(U.label(sec.title, "Heading", 28))
		for line in sec.lines:
			var l := U.para("· " + String(line), "Body", 21)
			l.custom_minimum_size.x = 200
			list.add_child(l)
		list.add_child(U.gap(0, 16))
