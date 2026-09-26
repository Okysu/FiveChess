## 地图 (src/game/scenes/map.ts): horizontally scrolling node graph with dotted ink paths (path_dot textures), node
## semantics (available ring, visited stamp, 观星 previews), boss preview, legend anchored bottom-right, act intro.
## Variant metadata on the root: row_w, col_h, pad_y, node_size, icon_size, ring_size.
extends RunScreen

const NODE_INFO := {
	"combat": ["战斗", "与游荡的敌人交战，胜利后获得金币与卡牌。"],
	"elite": ["精英", "强大的敌人。胜利可获得遗物。"],
	"event": ["事件", "命数交错之处，福祸难料。"],
	"shop": ["商店", "购买卡牌、遗物、丹药，或付费除牌。"],
	"camp": ["营地", "升级一张牌、删除一张牌，或恢复生命。"],
	"chest": ["宝箱", "获得一件遗物与些许金币。"],
	"recruit": ["招贤", "招募一位副将：获得第三个技能与第二种颜色。"],
	"stargaze": ["观星台", "删改天命牌堆，或预览前路的具体内容。"],
	"boss": ["首领", "本幕首领。"],
}
const X0 := 170.0

var row_w := 210.0
var col_h := 118.0
var pad_y := 80.0
var node_size := 104.0
var icon_size := 64.0
var ring_size := 104.0
var _rings: Array = []
var _t := 0.0

func enter() -> void:
	setup({"bg": "map_%d" % Session.run.act, "music": "map%d" % mini(4, Session.run.act)})
	Audio.ambience(["forest", "water", "stars", "void"][clampi(run.act - 1, 0, 3)])
	row_w = get_meta("row_w", row_w)
	col_h = get_meta("col_h", col_h)
	pad_y = get_meta("pad_y", pad_y)
	node_size = maxf(get_meta("node_size", node_size), Layout.touch_min())
	icon_size = get_meta("icon_size", icon_size)
	ring_size = get_meta("ring_size", ring_size)
	var at := part("ActTitle") as Label
	if at != null:
		at.text = "第%s幕 · %s" % [["", "一", "二", "三", "终"][clampi(run.act, 0, 4)], C.act_name(run.act)]
	_legend()
	draw_map()
	var lb := part("LegendBtn") as BaseButton
	if lb != null:
		lb.pressed.connect(func(): (%Legend as Control).visible = not (%Legend as Control).visible)
		(%Legend as Control).visible = false

func shown() -> void:
	if run.screen.k == "actStart":
		_act_intro()

func _pos(n: Dictionary) -> Vector2:
	if run.act == 4:
		return Vector2(X0 + n.row * 520 + 200, pad_y + 3 * col_h)
	return Vector2(X0 + n.row * row_w + (n.x - (n.col + 0.5) / 7.0) * 600.0, pad_y + n.col * col_h)

func _boss_link() -> Vector2:
	return Vector2(X0 + 15 * row_w + 160, pad_y + 3 * col_h)

func draw_map() -> void:
	var graph := %Graph as MapGraph
	U.clear(graph)
	_rings.clear()
	graph.dots.clear()
	var hist: Array = run.history.filter(func(h): return h.act == run.act)
	var on_path := func(n): return hist.any(func(h): return h.row == n.row and h.col == n.col)
	var avail: Array = MqRun.available_nodes(run)
	var is_avail := func(n): return avail.any(func(a): return a.row == n.row and a.col == n.col)
	# paths
	for row in run.map.rows:
		for n in row:
			var p := _pos(n)
			for nc in n.next:
				var t = null
				if n.row + 1 < run.map.rows.size():
					for x in run.map.rows[n.row + 1]:
						if x.col == nc:
							t = x
				if t == null:
					continue
				var walked: bool = on_path.call(n) and on_path.call(t)
				graph.dashed(p, _pos(t), walked)
	var last_row: Array = run.map.rows[run.map.rows.size() - 1] if run.map.rows.size() > 0 else []
	if run.act != 4:
		for n in last_row:
			graph.dashed(_pos(n), _boss_link(), false, 0.6)
	# nodes
	var ph := Layout.is_phone()
	for row in run.map.rows:
		for n in row:
			var p := _pos(n)
			var info: Array = NODE_INFO[n.type]
			var node := Control.new()
			node.size = Vector2(node_size, node_size)
			node.custom_minimum_size = node.size
			node.position = p - node.size / 2.0
			node.pivot_offset = node.size / 2.0
			node.mouse_filter = Control.MOUSE_FILTER_PASS
			var done: bool = on_path.call(n)
			var avl: bool = is_avail.call(n)
			if avl:
				var ring := Wb.sprite("ring_gold", Vector2(ring_size, ring_size))
				ring.position = (node.size - ring.size) / 2.0
				node.add_child(ring)
				_rings.append([ring, randf() * 1000.0])
			var ic := Wb.icon("node_" + n.type, icon_size)
			ic.position = (node.size - ic.size) / 2.0
			node.add_child(ic)
			if done:
				var stamp := Wb.sprite("stamp_visited", Vector2(96, 96) * (icon_size / 64.0), {"modulate": Color(1, 1, 1, 0.9)})
				stamp.position = (node.size - stamp.size) / 2.0
				node.add_child(stamp)
				ic.modulate.a = 0.6
			elif not avl:
				node.modulate.a = 0.45 if run.pos != null and n.row <= run.pos.row else 0.85
			if avl:
				node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
				var nn: Dictionary = n
				U.tappable(node, func(): _choose(nn))
				node.mouse_entered.connect(func(): node.create_tween().tween_property(node, "scale", Vector2(1.15, 1.15), 0.12))
				node.mouse_exited.connect(func(): node.create_tween().tween_property(node, "scale", Vector2.ONE, 0.12))
			var lines: Array = [{"title": info[0], "body": info[1]}]
			var prev = run.previews.get("%d:%d:%d" % [run.act, n.row, n.col])
			if prev != null:
				lines.append({"title": "观星所见", "body": _preview_text(prev)})
			Tip.attach(node, lines, 360)
			graph.add_child(node)
	# boss
	var boss_id = run.bosses.get(run.act, run.bosses.get(str(run.act)))
	var enc = MqContent.encounters.get(boss_id) if boss_id != null else null
	var boss = null
	if enc != null:
		for e in enc.enemies:
			var ed = MqContent.enemies.get(e.id)
			if ed != null and ed.tier == "boss":
				boss = ed
				break
	var width := X0 + 16 * row_w + 600
	if boss != null:
		var bc := Vector2(X0 + 2 * 520 + 200, pad_y + 3 * col_h) if run.act == 4 else _boss_link() + Vector2(120 + (40 if ph else 0), 0)
		var bs := Vector2(260, 330) * (1.15 if ph else 1.0)
		var b := Control.new()
		b.size = bs + Vector2(0, 60)
		b.position = bc - bs / 2.0
		b.pivot_offset = bs / 2.0
		b.mouse_filter = Control.MOUSE_FILTER_PASS
		var boss_avail := avail.any(func(a): return a.type == "boss")
		if boss_avail:
			var fr := Panel.new()
			fr.add_theme_stylebox_override("panel", Wb.nine("frame_red", {"expand": 12.0}))
			fr.size = bs
			fr.mouse_filter = Control.MOUSE_FILTER_IGNORE
			b.add_child(fr)
			_rings.append([fr, 0.0])
		var pnl := Panel.new()
		pnl.theme_type_variation = "PanelDarkBg"
		pnl.size = bs
		pnl.mouse_filter = Control.MOUSE_FILTER_IGNORE
		b.add_child(pnl)
		var bt := Assets.tex(K.enemy(boss.id, true))
		if bt != null:
			var win := Rect2(bs.x / 2.0 - 96 * bs.x / 260.0, 35 * bs.y / 330.0, 192 * bs.x / 260.0, 262 * bs.y / 330.0)
			b.add_child(U.tex_window(bt, U.rect_points(win), Rect2(win.position.x, win.position.y - 20, win.size.x, bt.get_height() * (bs.y * 0.91 / bt.get_height())), 0.0))
		var nm := U.label(boss.name, "NoteTitle", 30, Color8(0xff, 0xc8, 0xa0))
		nm.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		nm.position = Vector2(0, bs.y + 4)
		nm.size = Vector2(bs.x, 50)
		b.add_child(nm)
		if boss_avail:
			b.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
			U.tappable(b, func(): _choose(MqRun.boss_node(run)))
		Tip.attach(b, [{"title": boss.name, "body": boss.lore}], 420, "left")
		graph.add_child(b)
		width = maxf(width, b.position.x + bs.x + 200)
	graph.custom_minimum_size = Vector2(width, pad_y * 2 + 6 * col_h)
	graph.queue_redraw()
	# keep the current position in view
	var cur: int = run.pos.row if run.pos != null else -1
	var sc := %Scroll as WbScroll
	sc.set_deferred("scroll_horizontal", int(maxf(0.0, X0 + (cur + 1) * row_w - 700)))

func _choose(n: Dictionary) -> void:
	Tip.hide()
	Audio.sfx("step")
	var err = Router.act({"t": "go", "row": n.row, "col": n.col})
	if err != null:
		U.toast(err)

func _legend() -> void:
	var g := %LegendGrid as GridContainer
	U.clear(g)
	var isz: float = get_meta("legend_icon", 40.0)
	for t in ["combat", "elite", "event", "shop", "camp", "chest", "recruit", "stargaze"]:
		var h := U.hbox(6)
		h.add_child(Wb.icon("node_" + t, isz))
		var l := U.label(NODE_INFO[t][0], "Body", 18)
		l.custom_minimum_size.x = isz * 1.9
		h.add_child(l)
		g.add_child(h)

func _preview_text(id: String) -> String:
	var enc = MqContent.encounters.get(id)
	if enc != null:
		var names: Array = []
		for e in enc.enemies:
			var ed = MqContent.enemies.get(e.id)
			names.append(ed.name if ed != null else e.id)
		return "、".join(names)
	var ev = MqContent.events.get(id)
	return "事件：" + ev.title if ev != null else id

func _act_intro() -> void:
	var intro = Assets.read_json("res://data/lore/intro.json")
	var a = intro.acts.get(str(run.act)) if intro is Dictionary else null
	var ov := %Intro as Control
	(%IntroDim as TextureRect).texture = Wb.tex("dim_vignette")
	(%IntroTitle as Label).text = a.title if a != null else "第%d幕" % run.act
	(%IntroSub as Label).text = a.subtitle if a != null else C.act_name(run.act)
	(%IntroText as Label).text = a.text if a != null else ""
	ov.visible = true
	ov.modulate.a = 0.0
	Audio.sfx("bossIntro")
	ov.create_tween().tween_property(ov, "modulate:a", 1.0, 0.7)
	var done := [false]
	ov.gui_input.connect(func(e: InputEvent):
		if done[0] or not (e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT):
			return
		done[0] = true
		var tw := ov.create_tween()
		tw.tween_property(ov, "modulate:a", 0.0, 0.4)
		await tw.finished
		ov.visible = false
		Session.act({"t": "proceed"})
		draw_map())

func _process(delta: float) -> void:
	_t += delta * 1000.0
	for r in _rings:
		var c: Control = r[0]
		if is_instance_valid(c):
			var ph: float = (_t + r[1]) / 280.0
			c.modulate.a = 0.45 + 0.45 * sin(ph)
