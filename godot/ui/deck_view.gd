## Deck / pile viewer, card inspector, art viewer and the card picker (openDeck / inspectCard / viewArt / pickCards in
## src/game/ui/hud.ts). The modal bodies are scene variants: scenes/<profile>/deck_view.tscn (a CardGrid whose card
## scale fits the profile) and scenes/<profile>/inspect.tscn.
class_name DeckView
extends RefCounted

const TYPE_ORDER := ["unit", "tactic", "response", "equip", "delay", "field", "status", "curse"]

static func cost_total(d: Dictionary) -> int:
	if typeof(d.cost.g) == TYPE_STRING:
		return 0
	return int(d.cost.g) + (d.cost.c.size() if d.cost.get("c") != null else 0)

## type → total cost → name (sortCards)
static func sort_cards(cards: Array) -> Array:
	return MqU.stable_sort(cards.duplicate(), func(a, b):
		var da := MqContent.card(a.id, a.get("up", false))
		var db := MqContent.card(b.id, b.get("up", false))
		var t := TYPE_ORDER.find(da.type) - TYPE_ORDER.find(db.type)
		if t != 0: return t
		var c := cost_total(da) - cost_total(db)
		if c != 0: return c
		return MqU.str_cmp(da.name, db.name))

static func body(m: Modal, scene: String) -> Control:
	var b: Control = load(Layout.scene_dir() + scene + ".tscn").instantiate()
	b.size_flags_vertical = Control.SIZE_EXPAND_FILL
	m.body.add_child(b)
	return b

static func open(cards: Array, title: String, o := {}) -> Modal:
	var m := Modal.open(Vector2(1640, 940), {"title": "%s（%d）" % [title, cards.size()]})
	var b := body(m, "deck_view")
	var grid := b.get_node("%Grid") as CardGrid
	grid.set_cards(cards if o.get("sort", true) == false else sort_cards(cards))
	var note := b.get_node("%Note") as Label
	note.text = o.get("note", "")
	note.visible = note.text != ""
	return m

## large inspect view with the upgrade comparison and the keyword glossary
static func inspect(id: String, up: bool) -> Modal:
	var d := MqContent.card(id, up)
	var m := Modal.open(Vector2(1500, 900), {"title": String(d.name) + ("+" if up and not String(d.name).ends_with("+") else "")})
	var b := body(m, "inspect")
	var main := b.get_node("%Main") as Container
	main.add_child(CardView.make(id, up, b.get_meta("main_scale", 1.45)))
	for v in main.get_children():
		(v as CardView).hover_grow = false
	var base := MqContent.card(id)
	var other_box := b.get_node("%Other") as VBoxContainer
	other_box.visible = base.get("upgrade") != null
	if other_box.visible:
		var t := U.label("升级前" if up else "升级后", "Heading", 26, C.text_dim if up else C.jade)
		t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		other_box.add_child(t)
		var ov := CardView.make(id, not up, b.get_meta("other_scale", 1.05))
		ov.modulate.a = 0.92
		ov.hover_grow = false
		ov.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
		other_box.add_child(ov)
	var info := b.get_node("%Info") as VBoxContainer
	var up_text := ""
	if base.get("upgrade") != null and base.upgrade.get("text") != null:
		up_text = base.upgrade.text
	for l in UiGloss.lines(UiGloss.terms_of(String(d.text) + " " + up_text)):
		info.add_child(U.label(l.title, "Heading", 26, l.get("color", C.gold_light)))
		var r := RichLabel.make(l.body, {"size": 19, "color": Color8(0xe8, 0xdc, 0xc4), "term_color": C.term, "light": true})
		info.add_child(r)
	if String(d.get("flavor", "")) != "":
		info.add_child(U.gap(0, 10))
		info.add_child(U.para("「%s」" % d.flavor, "Dim", 20))
	var art := b.get_node("%ArtBtn") as WbButton
	art.pressed.connect(func(): view_art(d.faction, id, d.name))
	return m

static func view_art(faction: String, id: String, name: String) -> void:
	var t := Assets.tex(K.card(faction, id))
	if t == null:
		U.toast("插画尚未生成")
		return
	var m := Modal.open(Vector2(1100, 1000), {"title": name, "dim": 0.9})
	var r := TextureRect.new()
	r.texture = t
	r.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	r.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	r.size_flags_vertical = Control.SIZE_EXPAND_FILL
	r.mouse_filter = Control.MOUSE_FILTER_IGNORE
	r.modulate.a = 0.0
	m.body.add_child(r)
	r.create_tween().tween_property(r, "modulate:a", 1.0, 0.4)

## pick N cards from a list (remove / upgrade / transform / duplicate); o: title, n, min, confirm, upgrade_preview,
## optional, on_done(uids)
static func pick_cards(cards: Array, o: Dictionary) -> Modal:
	var optional: bool = o.get("optional", false)
	var m := Modal.open(Vector2(1640, 960), {"title": o.title, "closable": optional})
	var b := body(m, "deck_view")
	var grid := b.get_node("%Grid") as CardGrid
	var list := sort_cards(cards)
	var picked: Array = []
	var n: int = o.get("n", 1)
	var need: int = o.get("min", n)
	var confirm := WbButton.make(o.confirm, "primary", Vector2(260, 70), 30)
	confirm.disabled = need > 0
	var preview_holder := b.get_node("%Preview") as Control
	grid.on_pick = func(i: int, v: CardView):
		var uid = list[i].uid
		if picked.has(uid):
			picked.erase(uid)
			v.set_glow("none")
		else:
			if picked.size() >= n:
				var first = picked.pop_front()
				for w in grid.views:
					if w.uid == first:
						w.set_glow("none")
			picked.append(uid)
			v.set_glow("selected")
		confirm.disabled = picked.size() < need
	if o.get("upgrade_preview", false):
		preview_holder.custom_minimum_size.x = CardView.W * b.get_meta("preview_scale", 0.95) + 30
		grid.on_hover = func(i: int, v):
			U.clear(preview_holder)
			if v == null:
				return
			var pv := CardView.make(list[i].id, true, b.get_meta("preview_scale", 0.95))
			pv.hover_grow = false
			pv.mouse_filter = Control.MOUSE_FILTER_IGNORE
			preview_holder.add_child(pv)
	grid.set_cards(list)
	confirm.pressed.connect(func():
		m.close(true)
		o.on_done.call(picked.duplicate()))
	var row := b.get_node("%Buttons") as HBoxContainer
	row.visible = true
	row.add_child(confirm)
	if optional:
		row.add_child(WbButton.make("放弃", "ghost", Vector2(180, 70), 30, func():
			m.close(true)
			o.on_done.call([])))
	return m
