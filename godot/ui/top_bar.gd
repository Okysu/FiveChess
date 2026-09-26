## Run top bar (TopBar in src/game/ui/hud.ts): commander portrait, lieutenant portrait (tooltip with its bonuses),
## name + HP bar, gold, potion slots, act / floor line, deck / codex / settings plates, relic row.
## Anchored top-wide (full width at any aspect). Desktop and phone are scene variants (scenes/*/top_bar.tscn);
## the phone variant shows relics behind a 遗物 plate (touch targets ≥ 48 dp) instead of the tiny icon row.
## hooks: on_potion(i), on_deck(), on_map(), on_settings(), on_codex(), hp() -> {hp, max, armor}, potions() -> Array
class_name TopBar
extends Control

var run: Dictionary
var hooks := {}

static func create(r: Dictionary, h := {}) -> TopBar:
	var t: TopBar = load(Layout.scene_dir() + "top_bar.tscn").instantiate()
	t.run = r
	t.hooks = h
	return t

func _ready() -> void:
	var cmd: Dictionary = MqContent.commander(run.commander)
	var ps: float = get_meta("portrait_size", 64.0)
	var pp := %Portrait as Control
	pp.custom_minimum_size = Vector2(ps, ps)
	pp.add_child(U.portrait_disc(cmd.id, ps))
	var lt_holder := %Lieutenant as Control
	var lid = run.get("lieutenant")
	lt_holder.visible = lid != null and MqContent.lieutenants.has(lid)
	if lt_holder.visible:
		var lt: Dictionary = MqContent.lieutenants[lid]
		var ls: float = maxf(get_meta("lt_size", 48.0), Layout.touch_min())
		lt_holder.custom_minimum_size = Vector2(ls, ls)
		lt_holder.add_child(U.portrait_disc(lt.id, ls, Color8(0xc8, 0xf0, 0xd8)))
		var col: String = MqGloss.COLOR_INFO[lt.faction].name
		Tip.attach(lt_holder, [
			{"title": "副将 · %s「%s」" % [lt.name, lt.title], "body": "【%s】%s" % [lt.skill.name, lt.skill.text]},
			{"title": "本局加成", "body": "· 技能出现在战斗左侧的主帅技能旁\n· 开局 1 枚素源变为%s源\n· 奖励与商店卡池加入%s色牌\n· 仅限本局冒险，下一局需重新招贤" % [col, col]},
		], 400)
	(%Name as Label).text = "%s · %s" % [cmd.name, cmd.title]
	var gold := %GoldBox as Control
	(%GoldIcon as TextureRect).texture = Wb.icon_tex("ui_gold")
	Tip.attach(gold, [{"title": "金币", "body": "在商店购买卡牌、遗物、丹药与除牌服务。"}])
	var info := %Info as Label
	var a: int = run.act
	var short: bool = get_meta("short_info", false)
	info.text = ("第%s幕 · 第%d层" % [C.NUM_CN[a] if a < C.NUM_CN.size() else str(a), maxi(1, run.floor)]) if short else \
		"第%s幕 · %s · 第%d层%s" % [C.NUM_CN[a] if a < C.NUM_CN.size() else str(a), C.act_name(a), maxi(1, run.floor), ("   逆命 %d" % run.ascension) if run.ascension else ""]
	(%Deck as BaseButton).pressed.connect(func():
		if hooks.has("on_deck"): hooks.on_deck.call()
		else: DeckView.open(run.deck, "牌组"))
	(%Codex as BaseButton).pressed.connect(func(): if hooks.has("on_codex"): hooks.on_codex.call())
	(%Settings as BaseButton).pressed.connect(func(): if hooks.has("on_settings"): hooks.on_settings.call())
	var mb := part("MapBtn") as BaseButton
	if mb != null:
		mb.visible = hooks.has("on_map")
		if mb.visible:
			mb.pressed.connect(func(): hooks.on_map.call())
	var rb := part("RelicBtn") as BaseButton
	if rb != null:
		rb.pressed.connect(func(): RelicList.open(run))
	refresh()

func part(n: String) -> Node:
	return get_node_or_null("%" + n)

func refresh() -> void:
	var live = hooks.on_hp.call() if hooks.has("on_hp") else null
	var hp: int = live.hp if live != null else run.hp
	var mx: int = live.max if live != null else run.maxHp
	var armor: int = live.armor if live != null else 0
	(%Hp as WbBar).set_value(float(hp) / maxf(1.0, mx))
	(%HpText as Label).text = "%d/%d" % [hp, mx]
	var ab := part("Armor") as Label
	if ab != null:
		ab.visible = armor > 0
		ab.text = "护甲 %d" % armor
	(%Gold as Label).text = str(run.gold)
	_label(%Deck, "牌组 %d" % run.deck.size(), str(run.deck.size()))
	# potions
	var box := %Potions as HBoxContainer
	U.clear(box)
	var ss: Vector2 = get_meta("slot_size", Vector2(70, 64))
	ss = Vector2(maxf(ss.x, Layout.touch_min()), maxf(ss.y, Layout.touch_min()))
	var pots: Array = hooks.potions.call() if hooks.has("potions") else run.potions
	for i in pots.size():
		var id = pots[i]
		var slot := Panel.new()
		slot.theme_type_variation = "PanelSlotBg"
		slot.custom_minimum_size = ss
		slot.mouse_filter = Control.MOUSE_FILTER_IGNORE
		if id == null:
			slot.modulate.a = 0.55
		else:
			var ic := Wb.sprite(Assets.tex(K.potion(id)), ss * 0.78)
			ic.position = ss * 0.11
			slot.add_child(ic)
			Tip.attach(slot, U.potion_lines(id), 380)
			var idx: int = i
			U.tappable(slot, func():
				Tip.hide()
				if hooks.has("on_potion"): hooks.on_potion.call(idx))
		box.add_child(slot)
	# relics
	if part("RelicBtn") != null:
		_label(part("RelicBtn"), "遗物 %d" % run.relics.size(), str(run.relics.size()))
	var row := part("Relics") as Container
	if row != null:
		U.clear(row)
		var rs: float = get_meta("relic_size", 44.0)
		for rst in run.relics:
			var def = MqContent.relics.get(rst.id)
			if def == null:
				continue
			var c := U.relic_disc(rst.id, rs)
			if MqU.truthy(rst.get("counter")):
				var ct := U.label(str(rst.counter), "Num", 14)
				ct.position = Vector2(rs * 0.62, rs * 0.52)
				c.add_child(ct)
			Tip.attach(c, U.relic_lines(rst.id), 380, "below")
			row.add_child(c)

func _label(b, text: String, count: String) -> void:
	if b is WbButton:
		b.text = text
	elif b is IconButton:
		b.badge = count

## flash a relic icon when it triggers (combat)
func pulse_relic(id: String) -> void:
	var row := part("Relics") as Container
	if row == null:
		return
	for i in run.relics.size():
		if run.relics[i].id == id and i < row.get_child_count():
			var c := row.get_child(i) as Control
			c.pivot_offset = c.size / 2.0
			var tw := c.create_tween()
			tw.tween_property(c, "scale", Vector2(1.35, 1.35), 0.12)
			tw.tween_property(c, "scale", Vector2.ONE, 0.22)
			return
