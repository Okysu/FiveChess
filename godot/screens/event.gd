## 事件 (src/game/scenes/event.ts): illustration left, title / text / options right. Option rows size to their text
## (hint line under it, 条件不足 when a requirement fails); an outcome shows the continue plate.
extends RunScreen

func enter() -> void:
	var sc: Dictionary = Session.run.screen
	setup({"bg": "event", "music": "map%d" % mini(4, Session.run.act), "dim": 0.35})
	var ev: Dictionary = MqContent.events[sc.id]
	var art := %Art as TextureRect
	art.texture = Assets.tex(K.event(ev.id))
	art.modulate.a = 0.0
	art.create_tween().tween_property(art, "modulate:a", 1.0, 0.5)
	(%EvTitle as Label).text = ev.title
	var page = null
	if MqU.truthy(sc.get("page")) and ev.get("pages") != null:
		for p in ev.pages:
			if p.id == sc.page:
				page = p
	var body: String = sc.outcome if sc.get("outcome") != null else (page.text if page != null else ev.text)
	var options: Array = [] if sc.get("outcome") != null else (page.options if page != null else ev.options)
	(%Text as RichLabel).set_rich(body, {"size": 26, "color": Color8(0xf0, 0xe4, 0xcc), "light": true, "term_color": C.term, "line": 10})
	var list := %Options as VBoxContainer
	U.clear(list)
	for i in options.size():
		list.add_child(_option(options[i], i))
	list.visible = not options.is_empty()
	if sc.get("outcome") != null:
		continue_button("继续", func(): Router.act({"t": "proceed"}))

func _option(o: Dictionary, i: int) -> Control:
	var ok: bool = o.get("requires") == null or MqRun.check_cond(run, o.requires)
	var row := PanelContainer.new()
	row.theme_type_variation = "PanelRow"
	row.custom_minimum_size.y = Layout.tap(74)
	var m := U.margin(34, 8, 34, 8)
	row.add_child(m)
	var col := U.vbox(4)
	col.alignment = BoxContainer.ALIGNMENT_CENTER
	m.add_child(col)
	var t := U.para(String(o.text), "Body", 24, C.text if ok else C.text_dim)
	col.add_child(t)
	if o.get("hint") != null or not ok:
		var hint: String = ("（条件不足）" + String(o.get("hint", ""))) if not ok else String(o.hint)
		col.add_child(U.para(hint, "Body", 19, Color8(0xa0, 0x80, 0x70) if not ok else _hint_color(hint)))
	row.modulate.a = 0.92 if ok else 0.5
	row.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if ok else Control.CURSOR_FORBIDDEN
	row.mouse_entered.connect(func(): if ok: row.modulate.a = 1.0)
	row.mouse_exited.connect(func(): row.modulate.a = 0.92 if ok else 0.5)
	U.tappable(row, func():
		if not ok:
			Audio.sfx("deny")
			return
		Audio.sfx("click")
		var err = Router.act({"t": "event", "i": i})
		if err != null:
			U.toast(err))
	return row

static var _re_bad: RegEx

func _hint_color(h: String) -> Color:
	if _re_bad == null:
		_re_bad = RegEx.create_from_string("失去|扣|诅咒|代价|-")
	return C.bad if _re_bad.search(h) != null else C.good
