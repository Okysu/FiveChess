## 营地 (src/game/scenes/camp.ts): 修炼 (upgrade) / 斩念 (remove) / 调息 (heal), one per visit.
## Variant metadata: option_size, icon_size.
extends RunScreen

func enter() -> void:
	setup({"bg": "camp", "music": "camp", "dim": 0.2})
	var r: Dictionary = Session.run
	var sc: Dictionary = r.screen
	if sc.k != "camp":
		return
	var no_heal := false
	var bonus := 0
	for x in r.relics:
		var d = MqContent.relics.get(x.id)
		if d == null or d.get("run") == null:
			continue
		for rr in d.run:
			if rr.rule == "noHealAtRest":
				no_heal = true
			elif rr.rule == "restHealBonus":
				bonus += int(rr.amount)
	var heal: int = MqU.js_round(r.maxHp * 0.3) + bonus
	var can_up: bool = r.deck.any(func(d): return not d.up and MqContent.card(d.id).get("upgrade") != null)
	var opts := [
		{"key": "upgrade", "title": "修　炼", "sub": "升级 1 张卡牌", "icon": "kw_growth", "disabled": not can_up},
		{"key": "remove", "title": "斩　念", "sub": "移除 1 张卡牌", "icon": "kw_exhaust", "disabled": r.deck.is_empty()},
		{"key": "heal", "title": "调　息", "sub": "无法恢复" if no_heal else ("生命已满" if r.hp >= r.maxHp else "恢复 %d 生命\n%d → %d" % [heal, r.hp, mini(r.maxHp, r.hp + heal)]), "icon": "st_regen", "disabled": no_heal or r.hp >= r.maxHp},
	]
	var row := %Options as HBoxContainer
	var osz: Vector2 = get_meta("option_size", Vector2(340, 340))
	var isz: float = get_meta("icon_size", 96.0)
	var done: bool = sc.done
	for o in opts:
		var off: bool = o.disabled or done
		var p := PanelContainer.new()
		p.theme_type_variation = "PanelDark"
		p.custom_minimum_size = osz
		p.pivot_offset = osz / 2.0
		var col := U.vbox(8, BoxContainer.ALIGNMENT_CENTER)
		p.add_child(col)
		var ic := Wb.icon(o.icon, isz)
		ic.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
		col.add_child(ic)
		var t := U.label(o.title, "Heading", 44, C.text_dim if o.disabled else C.gold_light)
		t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		col.add_child(t)
		var s := U.label(o.sub, "Body", 22)
		s.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		col.add_child(s)
		if off:
			p.modulate.a = 0.5
		p.mouse_default_cursor_shape = Control.CURSOR_ARROW if off else Control.CURSOR_POINTING_HAND
		p.mouse_entered.connect(func(): if not off: p.create_tween().tween_property(p, "scale", Vector2(1.04, 1.04), 0.12))
		p.mouse_exited.connect(func(): p.create_tween().tween_property(p, "scale", Vector2.ONE, 0.12))
		var key: String = o.key
		U.tappable(p, func():
			if off:
				Audio.sfx("deny")
				return
			Audio.sfx("heal" if key == "heal" else "click")
			var err = Router.act({"t": "rest", "opt": key})
			if err != null:
				U.toast(err))
		row.add_child(p)
	if done:
		continue_button("继续前进 →", func(): Router.act({"t": "proceed"}))
