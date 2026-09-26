## 招贤 (src/game/scenes/recruit.ts): three lieutenant panels (portrait, name, school, skill, what recruiting adds), the
## explanation modal after choosing, or a small boon when a lieutenant already travels with you.
## Variant metadata: panel_width, portrait_height.
extends RunScreen

func enter() -> void:
	var sc: Dictionary = Session.run.screen
	setup({"bg": "recruit", "music": "camp", "heading": "「 招 贤 」", "dim": 0.3})
	var skip := %Skip as WbButton
	if sc.done:
		skip.visible = false
		continue_button("继续前进 →", func(): Router.act({"t": "proceed"}))
		return
	if sc.options.is_empty():
		skip.visible = false
		var t := U.para("已有副将随行。贤士们赠你盘缠，祝你一路顺风。", "NoteTitle", 34)
		t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		(%Choices as HBoxContainer).add_child(t)
		continue_button("收下（+50 金）", func(): Router.act({"t": "recruit", "i": null}))
		return
	skip.pressed.connect(func(): Router.act({"t": "recruit", "i": null}))
	var cmd_color: String = MqContent.commander(run.commander).faction
	var pw: float = get_meta("panel_width", 360.0)
	var phh: float = get_meta("portrait_height", 250.0)
	for i in sc.options.size():
		var id: String = sc.options[i]
		var lt: Dictionary = MqContent.lieutenants[id]
		var p := PanelContainer.new()
		p.theme_type_variation = "PanelDark"
		p.custom_minimum_size.x = pw
		p.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		var col := U.vbox(6)
		p.add_child(col)
		# portrait window (face crop near the top of the art)
		var win := Control.new()
		win.custom_minimum_size = Vector2(pw - 120, phh)
		win.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var tex := Assets.tex(K.hero(id))
		if tex != null:
			var w := pw - 120
			var k := (phh * 1.68) / tex.get_height()
			var draw_w := tex.get_width() * k
			win.add_child(U.tex_window(tex, U.rect_points(Rect2(0, 0, w, phh)), Rect2((w - draw_w) / 2.0, -30.0 * phh / 250.0, draw_w, tex.get_height() * k), 0.0))
		col.add_child(win)
		col.add_child(U.label(lt.name, "NoteTitle", 42, C.gold_light))
		col.add_child(U.label("「%s」 %s" % [lt.title, MqGloss.COLOR_INFO[lt.faction].school], "HeadingOutline", 22, C.faction_light(lt.faction)))
		col.add_child(U.label("【%s】%s" % [C.SKILL_TYPE.get(lt.skill.type, ""), lt.skill.name], "Heading", 26, Color8(0xff, 0xc8, 0x8a)))
		col.add_child(RichLabel.make(lt.skill.text, {"size": 20, "color": C.body_light, "light": true, "term_color": C.term}))
		var fc: String = MqGloss.COLOR_INFO[lt.faction].name
		col.add_child(U.para("招募后：1 枚素源变为%s源\n奖励卡池加入%s色（%s%s双色）" % [fc, fc, MqGloss.COLOR_INFO[cmd_color].name, fc], "Dim", 18))
		p.pivot_offset = Vector2(pw, 600) / 2.0
		p.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		p.mouse_entered.connect(func(): p.create_tween().tween_property(p, "scale", Vector2(1.03, 1.03), 0.12))
		p.mouse_exited.connect(func(): p.create_tween().tween_property(p, "scale", Vector2.ONE, 0.12))
		var lines := UiGloss.lines(UiGloss.terms_of(lt.skill.text))
		lines.append({"title": "生平", "body": lt.lore})
		Tip.attach(p, lines, 380)
		var idx: int = i
		U.tappable(p, func(): _explain(lt, idx))
		(%Choices as HBoxContainer).add_child(p)

## what a lieutenant does (shown before the run moves on)
func _explain(lt: Dictionary, i: int) -> void:
	Audio.sfx("relic")
	var col: String = MqGloss.COLOR_INFO[lt.faction].name
	var m := Modal.open(Vector2(960, 600), {"title": "%s 加入麾下" % lt.name, "closable": false})
	var t := U.para("副将不会上场作战，而是为你本局冒险提供三项加成（从下一场战斗开始）：\n\n【技能】%s：出现在战斗左侧主帅技能旁，标记“副将”。\n【源】开局 1 枚素源变为%s源，可以打出%s色牌。\n【卡池】之后的战斗奖励、商店与事件会出现%s色牌。\n\n现有牌组不会改变；副将仅限本局，下一局需重新招贤。" % [lt.skill.name, col, col, col], "Body", 24)
	t.add_theme_constant_override("line_spacing", 12)
	m.body.add_child(t)
	m.body.add_child(U.spacer(false))
	m.buttons([WbButton.make("知道了", "primary", Vector2(240, 72), 28, func():
		m.close(true)
		Router.act({"t": "recruit", "i": i}))])
