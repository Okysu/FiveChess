## 首领遗物 · 三选一 (bossRelic() in src/game/scenes/reward.ts). Variant metadata: panel_size, icon_size.
extends RunScreen

func enter() -> void:
	var sc: Dictionary = Session.run.screen
	setup({"bg": "victory", "music": "victory", "heading": "「 首领遗物 · 三选一 」", "dim": 0.45})
	var row := %Choices as HBoxContainer
	var ps: Vector2 = get_meta("panel_size", Vector2(420, 520))
	var isz: float = get_meta("icon_size", 190.0)
	for i in sc.options.size():
		var id: String = sc.options[i]
		var def: Dictionary = MqContent.relic(id)
		var p := PanelContainer.new()
		p.theme_type_variation = "PanelDark"
		p.custom_minimum_size = ps
		p.pivot_offset = ps / 2.0
		var col := U.vbox(10)
		p.add_child(col)
		var ic := Wb.sprite(Assets.tex(K.relic(id)), Vector2(isz, isz))
		ic.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
		col.add_child(ic)
		var nm := U.label(def.name, "Heading", 36)
		nm.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		col.add_child(nm)
		var tx := U.para(MqGloss.plain_rules(def.text), "Body", 22)
		tx.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		col.add_child(tx)
		p.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		p.mouse_entered.connect(func(): p.create_tween().tween_property(p, "scale", Vector2(1.04, 1.04), 0.12))
		p.mouse_exited.connect(func(): p.create_tween().tween_property(p, "scale", Vector2.ONE, 0.12))
		var idx: int = i
		U.tappable(p, func():
			Audio.sfx("relic")
			Router.act({"t": "bossRelic", "i": idx}))
		Tip.attach(p, UiGloss.lines(UiGloss.terms_of(def.text)), 380)
		row.add_child(p)
	(%Skip as WbButton).pressed.connect(func(): Router.act({"t": "bossRelic", "i": null}))
