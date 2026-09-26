## 主帅选择 (src/game/scenes/select.ts): commander list by school (locked ones dark with their unlock step), portrait
## + lore, details (skills, exclusive relic, starter deck mini-cards, record), ascension selector (per-level text from
## MqMeta.ASCENSION_TEXT, hover lists every active modifier), seed input, start.
## Variant metadata: tile_size, mini_scale.
extends Screen

var selected: Dictionary
var asc := 0

func _init() -> void:
	pass

func enter() -> void:
	App.inst.set_backdrop(K.bg("recruit"), Color8(0x6a, 0x6a, 0x6a))
	Audio.play_music("camp")
	var unlocked: Array = Session.profile.unlocked.commanders
	var all: Array = MqContent.commanders.values()
	selected = all[0]
	for c in all:
		if unlocked.has(c.id):
			selected = c
			break
	(%Back as WbButton).pressed.connect(func(): Router.show("title"))
	(%Prev as WbButton).pressed.connect(func(): _set_asc(asc - 1))
	(%Next as WbButton).pressed.connect(func(): _set_asc(asc + 1))
	(%Start as WbButton).pressed.connect(_start)
	var seed := %Seed as LineEdit
	seed.placeholder_text = "种子（可留空）"
	seed.max_length = 24
	seed.text_changed.connect(func(t: String):
		var clean := ""
		for ch in t.to_upper():
			if (ch >= "A" and ch <= "Z") or (ch >= "0" and ch <= "9") or ch == "_" or ch == "-":
				clean += ch
		if clean != t:
			var cp := seed.caret_column
			seed.text = clean
			seed.caret_column = mini(cp, clean.length()))
	Tip.attach(%AscDesc as Control, func():
		var lines: Array = []
		for i in range(1, asc + 1):
			lines.append("%d. %s" % [i, MqMeta.ASCENSION_TEXT[i]])
		return [{"title": "逆命 %d 生效的修正" % asc, "body": "\n".join(lines)}] if asc > 0 else [], 420, "above")
	_list()
	_show(selected)
	_set_asc(0)

func _set_asc(v: int) -> void:
	var mx: int = int(Session.profile.ascension.get(selected.id, 0))
	asc = clampi(v, 0, mx)
	(%Asc as Label).text = str(asc)
	var t := ""
	if asc == 0:
		t = "逆命 0：%s%s" % [MqMeta.ASCENSION_TEXT[0], ("（最高可选 %d）" % mx) if mx > 0 else ""]
	else:
		t = "逆命 %d：%s%s" % [asc, MqMeta.ASCENSION_TEXT[asc], ("（另含前 %d 级）" % (asc - 1)) if asc > 1 else ""]
	(%AscDesc as Label).text = t

func _list() -> void:
	var list := %List as Container
	U.clear(list)
	var unlocked: Array = Session.profile.unlocked.commanders
	var ts: Vector2 = get_meta("tile_size", Vector2(104, 142))
	ts = Vector2(maxf(ts.x, Layout.touch_min()), maxf(ts.y, Layout.touch_min()))
	for f in ["R", "B", "G", "Y", "P"]:
		var tag := U.label(MqGloss.COLOR_INFO[f].name, "NoteTitle", 30, C.faction(f))
		tag.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		list.add_child(tag)
		for c in MqContent.commanders.values():
			if c.faction != f:
				continue
			list.add_child(_tile(c, not unlocked.has(c.id), ts))

func _tile(c: Dictionary, locked: bool, ts: Vector2) -> Control:
	var tile := Panel.new()
	tile.theme_type_variation = "PanelTileBg"
	tile.custom_minimum_size = ts
	var tex := Assets.tex(K.hero(c.id))
	if tex != null:
		var inset := ts * Vector2(12.0 / 104.0, 12.0 / 142.0)
		var win := Rect2(inset, ts - inset * 2)
		var k := ts.y / (tex.get_height() * 0.45)
		var dw := tex.get_width() * k
		var poly := U.tex_window(tex, U.rect_points(win), Rect2((ts.x - dw) / 2.0, -6, dw, tex.get_height() * k), 0.0)
		if locked:
			poly.color = Color(0, 0, 0, 0.7)
		tile.add_child(poly)
	var nm := U.label("？？？" if locked else c.name, "NoteTitle", 22)
	nm.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	nm.vertical_alignment = VERTICAL_ALIGNMENT_BOTTOM
	nm.size = Vector2(ts.x, ts.y - ts.y * 0.1)
	tile.add_child(nm)
	if c.id == selected.get("id") and not locked:
		var fr := Panel.new()
		fr.add_theme_stylebox_override("panel", Wb.nine("frame_gold", {"expand": 6.0}))
		fr.size = ts
		fr.mouse_filter = Control.MOUSE_FILTER_IGNORE
		tile.add_child(fr)
	tile.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	U.tappable(tile, func():
		if locked:
			Audio.sfx("deny")
			return
		selected = c
		Audio.sfx("click")
		_list()
		_show(c)
		_set_asc(asc))
	if locked:
		var step = null
		for s in MqMeta.UNLOCK_TRACK:
			if s.has("commanders") and s.commanders.has(c.id):
				step = s
		Tip.attach(tile, [{"title": "未解锁", "body": ("累计命数达到 %d 后解锁（当前 %d）。" % [step.xp, Session.profile.xp]) if step != null else "继续冒险以解锁。"}], 380, "above")
	return tile

func _show(c: Dictionary) -> void:
	# portrait (desktop variant)
	var hero := part("Hero") as TextureRect
	if hero != null:
		hero.texture = Assets.tex(K.hero(c.id))
		hero.modulate.a = 0.0
		hero.create_tween().tween_property(hero, "modulate:a", 1.0, 0.35)
	var lore := part("LoreText") as Label
	if lore != null:
		lore.text = c.lore
	var col := %DetailCol as VBoxContainer
	U.clear(col)
	var head := U.hbox(10)
	head.add_child(U.label(c.name, "NoteTitle", 64, C.gold_light))
	var tt := U.label("「%s」" % c.title, "HeadingOutline", 32, C.faction_light(c.faction))
	tt.size_flags_vertical = Control.SIZE_SHRINK_END
	head.add_child(tt)
	col.add_child(head)
	var info := U.hbox(10)
	info.add_child(U.label("%s　生命 %d　初始源" % [MqGloss.COLOR_INFO[c.faction].school, c.hp], "Body", 24))
	for s in c.sources:
		info.add_child(Wb.pip(s, 40))
	col.add_child(info)
	for sk in c.skills:
		col.add_child(U.label("【%s】%s" % [C.SKILL_TYPE.get(sk.type, ""), sk.name], "Heading", 28, C.gold_light if sk.type == "passive" else Color8(0xff, 0x9a, 0x6a)))
		var r := RichLabel.make(sk.text, {"size": 21, "color": C.body_light, "light": true, "term_color": C.term})
		col.add_child(_indent(r))
		var g := UiGloss.lines(UiGloss.terms_of(sk.text))
		if not g.is_empty():
			Tip.attach(r, g, 380)
	var relic = MqContent.relics.get(c.relic)
	if relic != null:
		col.add_child(U.label("专属遗物：" + relic.name, "Heading", 26))
		var rr := RichLabel.make(relic.text, {"size": 20, "color": Color8(0xd8, 0xcc, 0xb4), "light": true, "term_color": C.term})
		col.add_child(_indent(rr))
		Tip.attach(rr, U.relic_lines(relic.id), 380)
	col.add_child(U.label("初始牌组（%d）" % c.deck.size(), "HeadingDim", 24))
	var deck := HFlowContainer.new()
	deck.add_theme_constant_override("h_separation", 10)
	deck.add_theme_constant_override("v_separation", 10)
	deck.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var ms: float = get_meta("mini_scale", 0.34)
	var seen: Array = []
	for id in c.deck:
		if seen.has(id):
			continue
		seen.append(id)
		var v := CardView.make(id, false, ms)
		var cid: String = id
		v.pressed.connect(func(): DeckView.inspect(cid, false))
		v.inspect.connect(func(): DeckView.inspect(cid, false))
		var n: int = c.deck.count(id)
		if n > 1:
			var badge := U.label("×%d" % n, "Num", 0, C.gold_light)
			badge.add_theme_font_size_override("font_size", int(60 * ms))
			badge.add_theme_constant_override("outline_size", maxi(3, int(8 * ms)))
			badge.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
			badge.vertical_alignment = VERTICAL_ALIGNMENT_BOTTOM
			badge.size = Vector2(CardView.W, CardView.H) * ms - Vector2(4, 0)
			v.add_child(badge)
		deck.add_child(v)
	col.add_child(deck)
	var st = Session.profile.commanderStats.get(c.id)
	col.add_child(U.label(("战绩：出征 %d · 通关 %d · 最高逆命 %d · 最远 %d 层" % [st.runs, st.wins, st.highestAsc, st.bestFloor]) if st != null else "尚无战绩", "Dim", 20))
	if lore == null:
		col.add_child(U.gap(0, 8))
		col.add_child(U.para(c.lore, "Body", 20, Color(C.text, 0.85)))

func _indent(c: Control) -> Control:
	var m := U.margin(16, 0, 0, 0)
	m.add_child(c)
	return m

func _start() -> void:
	Session.start_run(selected.id, asc, (%Seed as LineEdit).text)
	Audio.sfx("turnPlayer")
	Router.go(true)

func on_back() -> bool:
	Router.show("title")
	return true
