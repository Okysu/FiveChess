## 观星台 (src/game/scenes/stargaze.ts): edit the run's fate deck (remove / copy / change suit) or preview the road
## ahead; one operation per visit. Variant metadata: fate_scale, op_size.
extends RunScreen

var sel = null

func enter() -> void:
	var sc: Dictionary = Session.run.screen
	setup({"bg": "stargaze", "music": "map3", "heading": "「 改 写 天 命 」" if MqU.truthy(sc.get("mode")) else "「 观 星 台 」", "dim": 0.4})
	var ops_row := %Ops as HBoxContainer
	if sc.done:
		(%Grid as Control).get_parent().visible = false
		ops_row.visible = false
		(%Info as Label).visible = false
		(%Hint as Label).visible = false
		var done := %Done as VBoxContainer
		done.visible = true
		var pv = sc.get("preview")
		if pv is Array and not pv.is_empty():
			var p := U.panel("PanelDark")
			p.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
			var col := U.vbox(14)
			col.add_child(U.label("前路已在星图中显现；地图节点悬停可再次查看。", "Dim", 22))
			for x in pv:
				col.add_child(U.label("第 %d 层 · %s" % [x.row + 1, x.label], "Body", 26))
			p.add_child(col)
			done.add_child(p)
		else:
			var t := U.label("命数已改。", "Heading", 48)
			t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			done.add_child(t)
		continue_button("继续前进 →", func(): Router.act({"t": "proceed"}))
		return
	var fd: Array = run.fateDeck
	var yang := 0
	var yin := 0
	var omen := 0
	for f in fd:
		if f.get("omen", false) == true:
			omen += 1
		elif MqGloss.SUIT_INFO[f.suit].yang:
			yang += 1
		else:
			yin += 1
	(%Info as Label).text = "天命牌堆 %d 张 · 阳 %d / 阴 %d%s" % [fd.size(), yang, yin, (" · 凶兆 %d" % omen) if omen > 0 else ""]
	(%Hint as Label).text = "先点选一张命牌，再选择操作。每次观星只能做一件事。"
	_grid()
	var ops := [["删去此牌", "remove"], ["复制此牌", "copy"], ["改换命纹", "change"], ["预览前路", "preview"]]
	var osz: Vector2 = get_meta("op_size", Vector2(240, 70))
	var mode = sc.get("mode")
	for o in ops:
		if MqU.truthy(mode) and o[1] != mode:
			continue
		var op: String = o[1]
		ops_row.add_child(WbButton.make(o[0], "normal" if op == "preview" else "primary", osz, 28, func(): _do(op)))

func _grid() -> void:
	var g := %Grid as GridContainer
	U.clear(g)
	var fd: Array = run.fateDeck
	var idx: Array = range(fd.size())
	var suits: Array = ["sun", "thunder", "moon", "mountain"]
	idx = MqU.stable_sort(idx, func(a, b):
		var fa: Dictionary = fd[a]
		var fb: Dictionary = fd[b]
		var o := (1 if fa.get("omen", false) == true else 0) - (1 if fb.get("omen", false) == true else 0)
		if o != 0: return o
		var s := suits.find(fa.suit) - suits.find(fb.suit)
		if s != 0: return s
		return fa.rank - fb.rank)
	var k: float = get_meta("fate_scale", 0.62)
	_cols()
	if not (%GridScroll as Control).resized.is_connected(_cols):
		(%GridScroll as Control).resized.connect(_cols)
	for i in idx:
		var fc := FateCard.make(fd[i], k)
		fc.selected = sel == i
		fc.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		var ii: int = i
		fc.pressed.connect(func():
			sel = ii
			Audio.sfx("click")
			_grid())
		g.add_child(fc)

func _cols() -> void:
	var g := %Grid as GridContainer
	var w := (%GridScroll as Control).size.x
	var cw := FateCard.W * float(get_meta("fate_scale", 0.62))
	g.columns = maxi(1, int(floor((w - 30.0 + 16.0) / (cw + 16.0)))) if w > 0 else 14

func _do(op: String) -> void:
	if op != "preview" and sel == null:
		U.toast("请先点选一张命牌")
		Audio.sfx("deny")
		return
	if op == "change":
		var cur: Dictionary = run.fateDeck[sel]
		var m := Modal.open(Vector2(1100, 360), {"title": "改换命纹", "phone_full": false})
		var btns: Array = []
		for s in ["sun", "thunder", "moon", "mountain"]:
			if s == cur.suit:
				continue
			var suit: String = s
			btns.append(WbButton.make(MqGloss.SUIT_INFO[s].name, "normal", Vector2(220, 80), 32, func():
				m.close(true)
				var err = Router.act({"t": "fate", "op": "change", "idx": sel, "suit": suit})
				if err != null: U.toast(err)))
		m.body.add_child(U.spacer(false))
		m.buttons(btns)
		return
	var a := {"t": "fate", "op": op}
	if sel != null:
		a.idx = sel
	var err = Router.act(a)
	if err != null:
		U.toast(err)
