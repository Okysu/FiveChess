## Title (src/game/scenes/title.ts): logo art, menu, meta progress line, opening narration.
## Variant parameters are node metadata in the .tscn (%Menu: button_size, button_font).
extends Screen

func enter() -> void:
	App.inst.set_backdrop(K.bg("title"))
	Audio.play_music("title")
	Audio.ambience("forest")
	var logo := %Logo as TextureRect
	logo.texture = Wb.tex("logo")
	var sub := %Sub as Label
	logo.modulate.a = 0.0
	sub.modulate.a = 0.0
	var tw := create_tween()
	tw.tween_property(logo, "modulate:a", 1.0, 1.4).set_ease(Tween.EASE_OUT)
	var tw2 := create_tween()
	tw2.tween_interval(0.5)
	tw2.tween_property(sub, "modulate:a", 1.0, 1.4)

	var menu := %Menu as VBoxContainer
	var bs: Vector2 = menu.get_meta("button_size", Vector2(360, 74))
	var bf: int = menu.get_meta("button_font", 32)
	var add := func(t: String, fn: Callable, k := "normal", sub_t := ""):
		var b := WbButton.make(t, k, bs + (Vector2(0, 14) if sub_t != "" else Vector2.ZERO), bf, fn)
		b.sub = sub_t
		b.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
		menu.add_child(b)
	var r = Session.run
	if r != null:
		add.call("继续冒险", func(): Router.go(true), "primary", "第%d幕 · 第%d层" % [r.act, r.floor])
	add.call("新的冒险", func(): Router.show("select"), "normal" if r != null else "primary")
	add.call("图　　鉴", func(): Router.show("codex"))
	add.call("设　　置", func(): Settings.open())
	add.call("鸣　　谢", func(): Credits.open())

	var p: Dictionary = Session.profile
	var nu = MqMeta.next_unlock(p)
	(%Progress as Label).text = "命数 %d　·　通关 %d/%d\n%s" % [p.xp, p.wins, p.runs, ("下一解锁：%s（%d）" % [nu.label, nu.xp]) if nu != null else "全部内容已解锁"]

	var narr := part("Narration") as VBoxContainer
	if narr != null:
		var intro = Assets.read_json("res://data/lore/intro.json")
		var lines: Array = intro.opening if intro is Dictionary else []
		for i in lines.size():
			var l := U.label(lines[i], "Note", 24)
			l.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
			l.modulate.a = 0.0
			narr.add_child(l)
			var t := create_tween()
			t.tween_interval(1.5 + i * 0.7)
			t.tween_property(l, "modulate:a", 0.85, 0.9)
