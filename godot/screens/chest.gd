## 宝箱 (src/game/scenes/chest.ts): tap the chest to open it; then the relic and gold found.
extends RunScreen

func enter() -> void:
	var sc: Dictionary = Session.run.screen
	setup({"bg": "codex", "music": "map%d" % mini(4, Session.run.act), "heading": "「 宝 箱 」", "dim": 0.4})
	var chest := %Chest as TextureRect
	chest.texture = Wb.icon_tex("node_chest")
	var found := %Found as VBoxContainer
	if not sc.opened:
		found.visible = false
		(%Hint as Label).text = "点击开启"
		chest.mouse_filter = Control.MOUSE_FILTER_STOP
		chest.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		var once := [false]
		U.tappable(chest, func():
			if once[0]:
				return
			once[0] = true
			Audio.sfx("relic")
			chest.pivot_offset = chest.size / 2.0
			var tw := chest.create_tween()
			tw.tween_property(chest, "scale", Vector2(1.2, 1.2), 0.2).set_trans(Tween.TRANS_BACK)
			await tw.finished
			Router.act({"t": "open"}))
		return
	(%Hint as Label).visible = false
	chest.visible = false
	if sc.get("relic") != null:
		var def: Dictionary = MqContent.relic(sc.relic)
		var ic := %RelicIcon as TextureRect
		ic.texture = Assets.tex(K.relic(sc.relic))
		(%FoundText as Label).text = "获得遗物【%s】与 %d 金" % [def.name, sc.gold]
		(%RelicText as RichLabel).set_rich(def.text, {"size": 24, "color": Color8(0xf0, 0xe4, 0xcc), "light": true, "term_color": C.term, "align": "center"})
		Tip.attach(ic, U.relic_lines(sc.relic), 380)
	else:
		(%FoundText as Label).text = "获得 %d 金" % sc.gold
	continue_button("继续前进 →", func(): Router.act({"t": "proceed"}))
