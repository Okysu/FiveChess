## Relic list (phone top bar 遗物 plate): every relic of the run with its name and rules, in a scrolling modal.
class_name RelicList
extends RefCounted

static func open(run: Dictionary) -> Modal:
	var m := Modal.open(Vector2(1200, 860), {"title": "遗物（%d）" % run.relics.size()})
	var sc := WbScroll.new()
	sc.size_flags_vertical = Control.SIZE_EXPAND_FILL
	m.body.add_child(sc)
	var list := U.vbox(12)
	list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	sc.add_child(list)
	if run.relics.is_empty():
		list.add_child(U.label("尚无遗物。", "Dim", 24))
	var sz := 96.0 if not Layout.is_phone() else 130.0
	for rst in run.relics:
		var def = MqContent.relics.get(rst.id)
		if def == null:
			continue
		var row := U.hbox(20)
		row.add_child(U.relic_disc(rst.id, sz))
		var col := U.vbox(4)
		col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		col.add_child(U.label(def.name + (("（%d）" % rst.counter) if MqU.truthy(rst.get("counter")) else ""), "Heading", 26, Color8(0xff, 0x8a, 0x6a) if def.tier == "boss" else C.gold_light))
		col.add_child(RichLabel.make(def.text, {"size": 20, "color": C.body_light, "light": true}))
		row.add_child(col)
		list.add_child(row)
	return m
