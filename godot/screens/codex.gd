## 图鉴 panel (CodexPanel in src/game/scenes/codex.ts): cards (school filter, collection count, unknown cards face
## down), enemies, relics, commanders, fate, world, rules, run history. Used by the codex screen and as a modal.
## Body variant: scenes/<profile>/codex_panel.tscn; metadata: tab_size, filter_size, card_scale, tile_size, relic_size,
## fate_scale, copy_size.
class_name Codex
extends VBoxContainer

const TABS := [["cards", "卡牌"], ["enemies", "敌人"], ["relics", "遗物"], ["commanders", "主帅"], ["fate", "天命"], ["world", "世界"], ["rules", "规则"], ["history", "对局记录"]]

var tab := "cards"
var filter := "all"

static func open_modal() -> Modal:
	var m := Modal.open(Vector2(1800, 1000), {"title": "图鉴"})
	var p: Codex = load(Layout.scene_dir() + "codex_panel.tscn").instantiate()
	p.size_flags_vertical = Control.SIZE_EXPAND_FILL
	m.body.add_child(p)
	return m

func _ready() -> void:
	render()

func _disc() -> Dictionary:
	var p: Dictionary = Session.profile.discovered
	var r = Session.run.discovered if Session.run != null else null
	var out := {}
	for k in ["cards", "enemies", "relics"]:
		var s := {}
		for id in p[k]:
			s[id] = true
		if r != null:
			for id in r[k]:
				s[id] = true
		out[k] = s
	return out

func render() -> void:
	var tabs := %Tabs as HBoxContainer
	U.clear(tabs)
	var tsz: Vector2 = get_meta("tab_size", Vector2(150, 52))
	for t in TABS:
		var key: String = t[0]
		tabs.add_child(WbButton.make(t[1], "primary" if key == tab else "ghost", tsz, 22, func():
			tab = key
			render()))
	var body := %Body as Control
	U.clear(body)
	match tab:
		"cards": _cards(body)
		"enemies": _enemies(body)
		"relics": _relics(body)
		"commanders": _commanders(body)
		"fate": _fate(body)
		"world", "rules": _texts(body)
		"history": _history(body)

func _scroll(body: Control) -> WbScroll:
	var s := WbScroll.new()
	s.set_anchors_preset(Control.PRESET_FULL_RECT)
	body.add_child(s)
	return s

func _cards(body: Control) -> void:
	var col := U.vbox(10)
	col.set_anchors_preset(Control.PRESET_FULL_RECT)
	body.add_child(col)
	var bar := U.hbox(10)
	col.add_child(bar)
	var fsz: Vector2 = get_meta("filter_size", Vector2(100, 44))
	for f in ["all", "R", "B", "G", "Y", "P", "N"]:
		var key: String = f
		bar.add_child(WbButton.make("全部" if f == "all" else MqGloss.COLOR_INFO[f].name, "primary" if filter == f else "ghost", fsz, 20, func():
			filter = key
			render()))
	var list: Array = []
	for c in MqContent.cards.values():
		if c.get("pool") == false or ["token", "special", "basic"].has(c.rarity) or c.type == "status" or c.type == "curse":
			continue
		if filter != "all" and c.faction != filter:
			continue
		list.append({"id": c.id, "up": false})
	list = DeckView.sort_cards(list)
	var d := _disc()
	var found := 0
	for c in list:
		if d.cards.has(c.id):
			found += 1
		else:
			c.face_down = true
	bar.add_child(U.spacer())
	bar.add_child(U.label("收集 %d/%d" % [found, list.size()], "Heading", 24))
	var grid := CardGrid.new()
	grid.card_scale = get_meta("card_scale", 0.5)
	grid.gap = 20
	col.add_child(grid)
	grid.on_pick = func(i: int, v: CardView):
		if not list[i].get("face_down", false):
			DeckView.inspect(list[i].id, false)
	grid.set_cards(list)

func _enemies(body: Control) -> void:
	var s := _scroll(body)
	var flow := HFlowContainer.new()
	flow.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	flow.add_theme_constant_override("h_separation", 16)
	flow.add_theme_constant_override("v_separation", 16)
	s.add_child(flow)
	var d := _disc()
	var tiers := ["normal", "elite", "boss", "minion"]
	var list: Array = MqContent.enemies.values().filter(func(e): return (e.tier != "minion" or d.enemies.has(e.id)) and not String(e.id).begins_with("sandbox"))
	list = MqU.stable_sort(list, func(a, b): return MqU.cmp_or(a.act - b.act, tiers.find(a.tier) - tiers.find(b.tier)))
	var ts: Vector2 = get_meta("tile_size", Vector2(184, 224))
	for e in list:
		var known: bool = d.enemies.has(e.id)
		var tile := Panel.new()
		tile.theme_type_variation = "PanelTileBg"
		tile.custom_minimum_size = ts
		var tex := Assets.tex(K.enemy(e.id, e.tier == "boss"))
		if tex != null:
			var inset := 22.0 * ts.x / 184.0
			var win := Rect2(inset, inset, ts.x - inset * 2, ts.y * 0.75 - inset)
			var k := minf(ts.y * 0.76 / tex.get_height(), ts.y * 0.76 / tex.get_width())
			var dw := tex.get_width() * k
			var dh := tex.get_height() * k
			var poly := U.tex_window(tex, U.rect_points(win), Rect2((ts.x - dw) / 2.0, ts.y * 0.795 - dh, dw, dh), 0.5)
			if not known:
				poly.color = Color(0, 0, 0, 0.6)
			tile.add_child(poly)
		var n := U.label(e.name if known else "？？？", "Heading", 22, C.text)
		n.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		n.position = Vector2(0, ts.y * 0.8)
		n.size = Vector2(ts.x, ts.y * 0.18)
		n.clip_text = true
		n.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		tile.add_child(n)
		if known:
			var tier_name: String = {"normal": "普通", "elite": "精英", "boss": "首领", "minion": "仆从"}[e.tier]
			Tip.attach(tile, [{"title": "%s（第%d幕 · %s）" % [e.name, e.act, tier_name], "body": e.get("lore", "")}], 420)
		flow.add_child(tile)

func _relics(body: Control) -> void:
	var s := _scroll(body)
	var flow := HFlowContainer.new()
	flow.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	flow.add_theme_constant_override("h_separation", 14)
	flow.add_theme_constant_override("v_separation", 14)
	s.add_child(flow)
	var d := _disc()
	var order := ["starter", "common", "uncommon", "rare", "boss", "shop", "event"]
	var list: Array = MqU.stable_sort(MqContent.relics.values(), func(a, b): return order.find(a.tier) - order.find(b.tier))
	var rs: float = maxf(get_meta("relic_size", 96.0), Layout.touch_min())
	for r in list:
		var known: bool = d.relics.has(r.id)
		var c := U.relic_disc(r.id, rs)
		if not known:
			(c.get_child(1) as TextureRect).modulate = Color(0, 0, 0, 0.5)
		Tip.attach(c, U.relic_lines(r.id) if known else [{"title": "？？？", "body": "尚未获得"}], 380)
		flow.add_child(c)

func _commanders(body: Control) -> void:
	var s := _scroll(body)
	var col := U.vbox(8)
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	s.add_child(col)
	for cm in MqContent.commanders.values():
		var st = Session.profile.commanderStats.get(cm.id)
		var unlocked: bool = Session.profile.unlocked.commanders.has(cm.id)
		col.add_child(U.label("%s 「%s」 · %s" % [cm.name if unlocked else "？？？", cm.title, MqGloss.COLOR_INFO[cm.faction].school], "NoteTitle", 30, C.faction_light(cm.faction)))
		var txt: String = ("%s%s" % [cm.lore, ("\n\n【结局】" + cm.ending) if st != null and st.wins > 0 else "\n\n（以此主帅通关后解锁结局）"]) if unlocked else "尚未解锁。"
		var m := U.margin(20, 0, 30, 16)
		m.add_child(U.para(txt, "Body", 21))
		col.add_child(m)

func _fate(body: Control) -> void:
	var s := _scroll(body)
	var col := U.vbox(14)
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	s.add_child(col)
	var k: float = get_meta("fate_scale", 0.62)
	for suit in ["sun", "thunder", "moon", "mountain"]:
		var info: Dictionary = MqGloss.SUIT_INFO[suit]
		col.add_child(U.label("%s（%s）" % [info.name, "阳" if info.yang else "阴"], "Heading", 26, C.hex(info.color)))
		var row := HFlowContainer.new()
		row.add_theme_constant_override("h_separation", 10)
		row.add_theme_constant_override("v_separation", 10)
		row.mouse_filter = Control.MOUSE_FILTER_IGNORE
		for r in range(1, 14):
			var fc := FateCard.make({"suit": suit, "rank": r}, k)
			fc.mouse_filter = Control.MOUSE_FILTER_IGNORE
			row.add_child(fc)
		col.add_child(row)
	col.add_child(U.para("天命牌堆共 52 张，每场战斗重新洗混，双方共享。观星台、遗物与事件可以增删改冒险中的天命牌；逆命 13 起混入「凶兆」。", "Dim", 20))

func _texts(body: Control) -> void:
	var entries = Assets.read_json("res://data/lore/%s.json" % tab)
	var s := _scroll(body)
	var col := U.vbox(6)
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	s.add_child(col)
	if not (entries is Array):
		return
	for e in entries:
		col.add_child(U.label("%s%s" % [("［%s］" % e.category) if e.get("category", "") != "" else "", e.title], "Heading", 30))
		var m := U.margin(20, 0, 30, 14)
		m.add_child(U.para(MqGloss.plain_rules(e.text), "Body", 21))
		col.add_child(m)

func _history(body: Control) -> void:
	var hs: Array = Session.profile.history
	if hs.is_empty():
		var t := U.label("尚无对局记录。", "Dim", 26)
		t.position = Vector2(40, 40)
		body.add_child(t)
		return
	var s := _scroll(body)
	var col := U.vbox(10)
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	s.add_child(col)
	var cs: Vector2 = get_meta("copy_size", Vector2(130, 44))
	for h in hs:
		var cm = MqContent.commanders.get(h.commander)
		var row := U.panel("PanelRow")
		row.custom_minimum_size.y = Layout.tap(60)
		var hb := U.hbox(16)
		row.add_child(hb)
		var res: String = "通关" if h.result == "win" else "放弃" if h.result == "abandon" else "败北"
		var date := Time.get_datetime_string_from_unix_time(int(h.date / 1000.0) + int(Time.get_time_zone_from_system().bias * 60), true)
		var t := U.label("%s　%s　逆命%d　%s　第%d幕第%d层　命数+%d　种子 %s" % [date, cm.name if cm != null else h.commander, h.ascension, res, h.act, h.floor, h.score, h.seed], "Body", 20, C.good if h.result == "win" else C.text)
		t.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		t.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		hb.add_child(t)
		var seed: String = h.seed
		hb.add_child(WbButton.make("复制种子", "ghost", cs, 18, func():
			DisplayServer.clipboard_set(seed)
			U.toast("已复制种子")))
		col.add_child(row)
