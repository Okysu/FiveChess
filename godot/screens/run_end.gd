## 冒险结算 (src/game/scenes/runEnd.ts): victory (with the commander's ending and the epilogues of the story flags set
## during the run, lore/epilogues.json), defeat, and the hidden-boss choice.
extends Screen

func enter() -> void:
	var r: Dictionary = Session.run
	var sc: Dictionary = r.screen
	if sc.k == "hiddenChoice":
		_hidden()
		return
	(%Hidden as Control).visible = false
	var win: bool = sc.k == "victory"
	App.inst.set_backdrop(K.bg("victory" if win else "defeat"))
	Audio.play_music("victory" if win else "defeat")
	Audio.sfx("victory" if win else "defeat")
	(%Dim as TextureRect).texture = Wb.tex("dim_vignette")
	(%Petals as Ambient).visible = win
	(%Ink as Ambient).visible = not win
	var t := %EndTitle as Label
	t.text = "改 命 · 功 成" if win else "命 数 已 尽"
	t.add_theme_color_override("font_color", Color8(0xff, 0xd2, 0x7a) if win else Color8(0xc8, 0xb0, 0xb0))
	var cmd: Dictionary = MqContent.commander(r.commander)
	var intro = Assets.read_json("res://data/lore/intro.json")
	var body := ""
	if win:
		var parts: Array = [intro.victory if intro is Dictionary else "", cmd.get("ending", "")]
		var epi = Assets.read_json("res://data/lore/epilogues.json")
		if epi is Dictionary:
			for e in epi.get("victory", []):
				if r.flags.has(e.flag):
					parts.append(e.text)
		body = "\n\n".join(parts)
	elif intro is Dictionary:
		var d: Array = intro.defeat
		body = d[r.act % d.size()] if not d.is_empty() else ""
	(%Story as Label).text = body
	(%Stats as Label).text = "%s · 逆命 %d · 第%d幕 第%d层 · 精英 %d · 首领 %d · 最高单场伤害 %d · 命数 +%d" % [cmd.name, r.ascension, r.act, r.floor, r.stats.elites, r.stats.bosses, r.stats.maxDamage, MqMeta.run_score(r)]
	var nem := %Nemesis as Label
	nem.visible = not win and r.get("nemesis") != null
	if nem.visible:
		var n = MqContent.encounters.get(r.nemesis)
		var names: Array = []
		if n != null:
			for e in n.enemies:
				var ed = MqContent.enemies.get(e.id)
				if ed != null:
					names.append(ed.name)
		nem.text = "折戟于：" + "、".join(names)
	var ul := %Unlocks as VBoxContainer
	for i in Session.last_unlocks.size():
		var l := U.label("★ " + String(Session.last_unlocks[i]), "NoteTitle", 26, C.good)
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		l.modulate.a = 0.0
		ul.add_child(l)
		var tw := l.create_tween()
		tw.tween_interval(0.8 + i * 0.3)
		tw.tween_property(l, "modulate:a", 1.0, 0.4)
	(%Home as WbButton).pressed.connect(func():
		Session.run = null
		Session.combat = null
		Session.last_unlocks = []
		Router.show("title"))

func _hidden() -> void:
	(%End as Control).visible = false
	(%Hidden as Control).visible = true
	(%Petals as Ambient).visible = false
	(%Ink as Ambient).visible = false
	App.inst.set_backdrop(K.bg("battle_4"))
	Audio.play_music("map4")
	(%Dim as TextureRect).texture = Wb.tex("dim_vignette")
	(%Close as WbButton).pressed.connect(func(): Router.act({"t": "hidden", "go": false}))
	(%Face as WbButton).pressed.connect(func(): Router.act({"t": "hidden", "go": true}))
