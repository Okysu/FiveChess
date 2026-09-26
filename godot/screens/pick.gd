## Deck selection for remove / upgrade / transform / duplicate (the picker modal over the scene) and event card
## choices (pick.ts). Variant metadata: choice_scale.
extends RunScreen

const KIND := {
	"remove": ["选择要移除的牌", "移除"],
	"upgrade": ["选择要升级的牌（悬停预览升级后）", "升级"],
	"transform": ["选择要变化的牌", "变化"],
	"duplicate": ["选择要复制的牌", "复制"],
	"loseRelic": ["选择", "确定"],
}

var _picked: Array = []

func enter() -> void:
	var sc: Dictionary = Session.run.screen
	var src: String = sc.get("source", "")
	setup({"bg": "camp" if src == "camp" else "shop" if src == "shop" else "event", "dim": 0.55})
	if sc.k == "cardChoice":
		var h := %Heading as Label
		h.text = "选择 %d 张加入牌组" % sc.n
		h.visible = true
		var row := %Cards as HBoxContainer
		var k: float = get_meta("choice_scale", 0.8)
		for c in sc.options:
			var v := CardView.make(c.id, c.up, k, {}, c.uid)
			var cc: Dictionary = c
			v.pressed.connect(func():
				if _picked.has(cc.uid):
					_picked.erase(cc.uid)
					v.set_glow("none")
				elif _picked.size() < sc.n:
					_picked.append(cc.uid)
					v.set_glow("selected")
				Audio.sfx("click"))
			v.inspect.connect(func(): DeckView.inspect(cc.id, cc.up))
			row.add_child(v)
		continue_button("确定", func(): Router.act({"t": "pick", "uids": _picked.duplicate()}))
		return

func shown() -> void:
	var sc: Dictionary = Session.run.screen
	if sc.k != "pick":
		return
	var info: Array = KIND.get(sc.kind, KIND.remove)
	var cands: Array = MqRun.pick_candidates(run, sc.kind, sc.get("filter"))
	DeckView.pick_cards(cands, {
		"title": info[0], "n": sc.n, "confirm": info[1], "upgrade_preview": sc.kind == "upgrade", "optional": sc.optional,
		"on_done": func(uids: Array):
			Audio.sfx("buff" if sc.kind == "upgrade" else "discard")
			Router.act({"t": "pick", "uids": uids} if not uids.is_empty() else {"t": "proceed"}),
	})
