## 商店 (src/game/scenes/shop.ts): shopkeeper, five school cards + two neutral ones with prices, relics, potions and the
## removal service. Variant metadata: card_scale, relic_size, slot_size, service_size.
extends RunScreen

func enter() -> void:
	setup({"bg": "shop", "music": "shop", "dim": 0.25})
	var keeper := part("Keeper") as TextureRect
	if keeper != null:
		keeper.texture = Wb.tex("shopkeeper")
	_build()
	continue_button("离　开", func(): Router.act({"t": "proceed"}))

func _build() -> void:
	var sc: Dictionary = run.screen
	if sc.k != "shop":
		return
	var shop: Dictionary = sc.shop
	var ck: float = get_meta("card_scale", 0.58)
	# cards
	var cards := %Cards as HBoxContainer
	U.clear(cards)
	for i in shop.cards.size():
		var it: Dictionary = shop.cards[i]
		if i == shop.cards.size() - 2:
			cards.add_child(U.gap(40, 0))
		var col := U.vbox(6)
		cards.add_child(col)
		var v := CardView.make(it.card.id, it.card.up, ck)
		col.add_child(v)
		var sold: bool = it.get("sold", false) == true
		if sold:
			v.modulate.a = 0.15
			v.hover_grow = false
		var idx: int = i
		v.pressed.connect(func(): if not sold: _buy("card", idx, it.price))
		v.inspect.connect(func(): DeckView.inspect(it.card.id, it.card.up))
		var g := UiGloss.lines(UiGloss.terms_of(String(MqContent.card(it.card.id, it.card.up).text)))
		if not g.is_empty():
			Tip.attach(v, g, 320)
		col.add_child(_price(it.price) if not sold else U.label("已售出", "Dim", 20))
	# relics
	var relics := %Relics as HBoxContainer
	U.clear(relics)
	var rsz: float = maxf(get_meta("relic_size", 108.0), Layout.touch_min())
	for i in shop.relics.size():
		var it: Dictionary = shop.relics[i]
		var def: Dictionary = MqContent.relic(it.id)
		var col := U.vbox(4)
		var disc := Control.new()
		disc.custom_minimum_size = Vector2(rsz, rsz)
		disc.add_child(Wb.sprite("skill_disc_active" if def.tier == "shop" else "skill_disc", Vector2(rsz, rsz)))
		var ic := Wb.sprite(Assets.tex(K.relic(it.id)), Vector2(rsz, rsz) * 0.78)
		ic.position = Vector2(rsz, rsz) * 0.11
		disc.add_child(ic)
		var sold: bool = it.get("sold", false) == true
		if sold:
			disc.modulate.a = 0.2
		Tip.attach(disc, U.relic_lines(it.id), 380)
		var idx: int = i
		U.tappable(disc, func(): if not sold: _buy("relic", idx, it.price))
		col.add_child(disc)
		col.add_child(_price(it.price) if not sold else U.label(" ", "Dim", 20))
		relics.add_child(col)
	# potions
	var pots := %Potions as HBoxContainer
	U.clear(pots)
	var psz: float = maxf(get_meta("slot_size", 88.0), Layout.touch_min())
	for i in shop.potions.size():
		var it: Dictionary = shop.potions[i]
		var col := U.vbox(4)
		var slot := Panel.new()
		slot.theme_type_variation = "PanelSlotBg"
		slot.custom_minimum_size = Vector2(psz, psz)
		var ic := Wb.sprite(Assets.tex(K.potion(it.id)), Vector2(psz, psz) * 0.84)
		ic.position = Vector2(psz, psz) * 0.08
		slot.add_child(ic)
		var sold: bool = it.get("sold", false) == true
		if sold:
			slot.modulate.a = 0.2
		Tip.attach(slot, U.potion_lines(it.id), 380)
		var idx: int = i
		U.tappable(slot, func(): if not sold: _buy("potion", idx, it.price))
		col.add_child(slot)
		col.add_child(_price(it.price) if not sold else U.label(" ", "Dim", 20))
		pots.add_child(col)
	var full := %PotionsFull as Label
	full.visible = not run.potions.has(null)
	full.text = "行囊已满（%d/%d）" % [run.potions.size(), run.potions.size()]
	# removal service
	var svc := %Service as PanelContainer
	var removed: bool = shop.get("removed", false) == true
	(%SvcTitle as Label).add_theme_color_override("font_color", C.text_dim if removed else C.gold_light)
	(%SvcSub as Label).text = "本店已服务" if removed else "从牌组中移除一张牌"
	var sp := %SvcPrice as Container
	U.clear(sp)
	if not removed:
		sp.add_child(_price(shop.removePrice))
	svc.mouse_default_cursor_shape = Control.CURSOR_ARROW if removed else Control.CURSOR_POINTING_HAND
	if not svc.has_meta("wired"):
		svc.set_meta("wired", true)
		U.tappable(svc, func():
			var sh: Dictionary = run.screen.shop
			if sh.get("removed", false) == true:
				return
			if run.gold < sh.removePrice:
				U.toast("金币不足")
				Audio.sfx("deny")
				return
			Router.act({"t": "removeService"}))

func _price(n: int) -> Control:
	var h := U.hbox(4, BoxContainer.ALIGNMENT_CENTER)
	h.add_child(Wb.icon("ui_gold", 26.0 * (1.4 if Layout.is_phone() else 1.0)))
	h.add_child(U.label(str(n), "Num", 24, C.gold_light if run.gold >= n else Color8(0xe0, 0x5a, 0x4a)))
	return h

func _buy(what: String, i: int, price: int) -> void:
	if run.gold < price:
		U.toast("金币不足")
		Audio.sfx("deny")
		return
	var err = Session.act({"t": "buy", "what": what, "i": i})
	if err != null:
		U.toast(err)
		Audio.sfx("deny")
		return
	Audio.sfx("gold")
	top.refresh()
	_build()
