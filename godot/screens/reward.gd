## 奖励 (src/game/scenes/reward.ts): gold / card choice / relic / potion rows, the card-choice modal (3 cards with
## their colour tag), and the leave-with-unclaimed-rewards confirmation.
## Variant metadata: row_size, icon_size, choice_scale.
extends RunScreen

func enter() -> void:
	var sc: Dictionary = Session.run.screen
	setup({"bg": "battle_%d" % mini(4, Session.run.act), "music": "victory", "dim": 0.55,
		"heading": "「 力 克 强 敌 」" if sc.get("elite", false) else "「 大 捷 」"})
	_build()
	continue_button("继续前进 →", _proceed)

func _build() -> void:
	var sc: Dictionary = run.screen
	if sc.k != "reward":
		return
	var list := %Rows as VBoxContainer
	U.clear(list)
	var rs: Vector2 = get_meta("row_size", Vector2(620, 88))
	rs.y = Layout.tap(rs.y)
	var isz: float = get_meta("icon_size", 56.0)
	for i in sc.items.size():
		var it: Dictionary = sc.items[i]
		var taken: bool = it.get("taken", false) == true
		var row := PanelContainer.new()
		row.theme_type_variation = "PanelRow"
		row.custom_minimum_size = rs
		var h := U.hbox(20)
		h.add_child(U.gap(20, 0))
		var d := _describe(it, isz)
		h.add_child(d[0])
		var t := U.label(d[1], "Heading", 28, C.text_dim if taken else C.text)
		t.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		t.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		h.add_child(t)
		if taken:
			h.add_child(U.label("已领取", "Heading", 24, C.jade))
		h.add_child(U.gap(10, 0))
		row.add_child(h)
		if not taken:
			row.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
			var idx: int = i
			U.tappable(row, func(): _take(idx, it))
		if it.k == "relic":
			Tip.attach(row, U.relic_lines(it.id), 380)
		elif it.k == "potion":
			Tip.attach(row, U.potion_lines(it.id), 380)
		row.modulate.a = 0.0
		var tw := row.create_tween()
		tw.tween_interval(i * 0.08)
		tw.tween_property(row, "modulate:a", 1.0, 0.25)
		list.add_child(row)

func _describe(it: Dictionary, isz: float) -> Array:
	match it.k:
		"gold":
			return [Wb.icon("ui_gold", isz), "获得 %d 金" % it.n]
		"cards":
			return [Wb.icon("ui_deck", isz), "选择一张卡牌加入牌组"]
		"relic":
			return [Wb.sprite(Assets.tex(K.relic(it.id)), Vector2(isz, isz) * 1.07), "遗物【%s】" % MqContent.relic(it.id).name]
	var pd = MqContent.potions.get(it.id)
	return [Wb.sprite(Assets.tex(K.potion(it.id)), Vector2(isz, isz) * 1.07), "丹药【%s】" % (pd.name if pd != null else it.id)]

func _take(i: int, it: Dictionary) -> void:
	if it.k == "cards":
		_card_choice(i, it.options)
		return
	var err = Session.act({"t": "take", "i": i})
	if err != null:
		U.toast(err)
		Audio.sfx("deny")
		return
	Audio.sfx("gold" if it.k == "gold" else "relic" if it.k == "relic" else "click")
	top.refresh()
	_build()

func _card_choice(i: int, options: Array) -> void:
	var m := Modal.open(Vector2(1500, 820), {"title": "选择一张卡牌"})
	var own: Array = [MqContent.commander(run.commander).faction]
	if run.get("lieutenant") != null and MqContent.lieutenants.has(run.lieutenant):
		own.append(MqContent.lieutenants[run.lieutenant].faction)
	var row := U.hbox(60, BoxContainer.ALIGNMENT_CENTER)
	row.size_flags_vertical = Control.SIZE_EXPAND_FILL
	m.body.add_child(row)
	var k: float = get_meta("choice_scale", 0.95)
	for idx in options.size():
		var c: Dictionary = options[idx]
		var col := U.vbox(14, BoxContainer.ALIGNMENT_CENTER)
		var v := CardView.make(c.id, c.up, k)
		var ci: int = idx
		v.pressed.connect(func():
			m.close(true)
			Session.act({"t": "take", "i": i, "choice": ci})
			Audio.sfx("relic")
			top.refresh()
			_build())
		v.inspect.connect(func(): DeckView.inspect(c.id, c.up))
		var cd := MqContent.card(c.id, c.up)
		var g := UiGloss.lines(UiGloss.terms_of(String(cd.text)))
		if not g.is_empty():
			Tip.attach(v, g, 320)
		v.scale = Vector2(0.01, 0.01)
		var tw := v.create_tween()
		tw.tween_interval(idx * 0.09)
		tw.tween_property(v, "scale", Vector2.ONE, 0.3).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
		col.add_child(v)
		var f: String = cd.faction
		var tag_text: String = "素 · 中立" if f == "N" else ("%s · 主色" % MqGloss.COLOR_INFO[f].name if own[0] == f else "%s · 副色" % MqGloss.COLOR_INFO[f].name)
		var tag := U.label(tag_text, "Heading", 24, C.faction_light(f))
		tag.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		col.add_child(tag)
		row.add_child(col)
	var bs: Vector2 = get_meta("modal_button", Vector2(200, 64))
	m.buttons([
		WbButton.make("跳过", "ghost", bs, 28, func():
			m.close(true)
			Session.act({"t": "take", "i": i, "choice": null})
			_build()),
		WbButton.make("查看牌组", "ghost", bs, 28, func(): DeckView.open(run.deck, "牌组")),
	])

func _proceed() -> void:
	var sc: Dictionary = run.screen
	if sc.k == "reward" and sc.items.any(func(it): return it.get("taken", false) != true and it.k != "potion"):
		var m := Modal.open(Vector2(760, 320), {"title": "还有奖励未领取", "phone_full": false})
		m.body.add_child(U.spacer(false))
		var bs: Vector2 = get_meta("modal_button", Vector2(240, 64))
		m.buttons([
			WbButton.make("确定离开", "danger", bs, 28, func():
				m.close(true)
				Router.act({"t": "proceed"})),
			WbButton.make("返回", "ghost", bs, 28, func(): m.close()),
		])
		return
	Router.act({"t": "proceed"})
