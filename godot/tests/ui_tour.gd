## UI tour (port of src/game/dev/uiTour.ts): walks every screen and modal of a seeded run (forcing run screens like
## the web tour), saves a PNG per page into build/tour/<size>[-phone]/ and checks each page:
##   clipped    a Label / RichTextLabel whose text does not fit its rect (overflow, ellipsis, rich text taller than it)
##   offscreen  visible text outside the visible screen (Layout.view), unless it sits in a scroll box
##   overlap    two visible texts overlapping by more than 35% of the smaller one
##   touch      (phone) something tappable smaller than the 48 dp touch minimum
##   unfilled   text still showing a {var} placeholder (labels and rich-text sources)
##   english    English words in visible text (product / licence names allowed)
##   tooltip    a tooltip not attached next to its control or not fully on screen
##   error      errors / warnings pushed to the log while the page was shown
## Run it windowed (screenshots need a renderer), e.g.
##   godot --path godot --rendering-driver opengl3 --resolution 1920x1080 --position 0,0 -- --tour
##   godot --path godot --rendering-driver opengl3 --resolution 2400x1080 --position 0,0 -- --tour --profile=phone
## Options: --events=N|all (default all), --out=<dir>. Exit code = number of issues (0 = clean).
extends Node

class TourLogger:
	extends Logger
	var lines: Array = []
	var mutex := Mutex.new()
	func _log_error(function: String, file: String, line: int, code: String, rationale: String, editor_notify: bool, error_type: int, script_backtraces: Array) -> void:
		mutex.lock()
		var kind := "warning" if error_type == 1 else "error"
		lines.append([kind, "%s (%s:%d %s)" % [rationale if rationale != "" else code, file.get_file(), line, function]])
		mutex.unlock()
	func _log_message(message: String, error: bool) -> void:
		if error and not message.begins_with("   at:"):
			mutex.lock()
			lines.append(["error", message.strip_edges()])
			mutex.unlock()
	func take() -> Array:
		mutex.lock()
		var out := lines.duplicate()
		lines.clear()
		mutex.unlock()
		return out

const ALLOWED_EN := "https?:|Godot|PixiJS|yoga|zod|Vite|TypeScript|Noto|Shan|SIL|OFL|MIT|Apache|gpt-|Kenney|Tozan|OpenGameArt|CC0|WebAudio|manifest|ElevenLabs|Arena|UITOUR|flare"

var logger := TourLogger.new()
var pages: Array = []
var out_dir := ""
var n_page := 0
var events_limit := -1
var _re_var: RegEx
var _re_en: RegEx
var _re_allowed: RegEx

func _ready() -> void:
	OS.add_logger(logger)
	# the real pointer must not hover things while the tour drives the UI
	get_viewport().gui_disable_input = true
	_re_var = RegEx.create_from_string("\\{[a-z]\\w*\\}")
	_re_en = RegEx.create_from_string("[A-Za-z]{4,}")
	_re_allowed = RegEx.create_from_string(ALLOWED_EN)
	var win := DisplayServer.window_get_size()
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--out="):
			out_dir = a.trim_prefix("--out=")
		elif a.begins_with("--events="):
			var v := a.trim_prefix("--events=")
			events_limit = -1 if v == "all" else int(v)
	if out_dir == "":
		out_dir = "res://build/tour/%dx%d%s" % [win.x, win.y, "-phone" if Layout.is_phone() else ""]
	out_dir = ProjectSettings.globalize_path(out_dir)
	DirAccess.make_dir_recursive_absolute(out_dir)
	for f in DirAccess.get_files_at(out_dir):
		if f.ends_with(".png"):
			DirAccess.remove_absolute(out_dir.path_join(f))
	_run.call_deferred()

# ───────────── driving ─────────────

func _wait(t: float) -> void:
	await get_tree().create_timer(t).timeout

func _settle(extra := 0.6) -> void:
	await _wait(0.15)
	var guard := 0
	while App.inst.is_switching() and guard < 200:
		guard += 1
		await get_tree().process_frame
	await _wait(extra)

func _route() -> void:
	Router.go(true)
	await _settle(0.9)

func _force(r: Dictionary, name: String, screen: Dictionary) -> void:
	r.screen = screen
	Session.combat = null
	Modal.close_all()
	await page(name, _route)

func page(name: String, show: Callable, settle := 0.7) -> void:
	logger.take()
	Rich.warnings.clear()
	await show.call()
	await _settle(settle)
	n_page += 1
	var file := out_dir.path_join("%02d_%s.png" % [n_page, name])
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(file)
	var issues := check()
	issues.append_array(await check_tooltips())
	for e in logger.take():
		issues.append({"kind": e[0], "detail": e[1]})
	for w in Rich.warnings:
		issues.append({"kind": "unfilled", "detail": "rich text shows " + w})
	Rich.warnings.clear()
	pages.append({"name": name, "issues": _dedupe(issues)})
	print("page %02d %-28s %d issue(s)" % [n_page, name, pages[-1].issues.size()])

func _dedupe(list: Array) -> Array:
	var seen := {}
	var out: Array = []
	for i in list:
		var k: String = i.kind + "|" + i.detail
		if not seen.has(k):
			seen[k] = true
			out.append(i)
	return out

func _close() -> void:
	Modal.close_all()
	Tip.hide()
	await get_tree().process_frame

func _run() -> void:
	# never touch the player's real save; a tour profile with a little progress
	Session.persist = false
	while App.inst.screen_name != "title":
		await get_tree().process_frame
		if App.inst.screen_name == "" or App.inst.screen_name == "boot":
			continue
		if Session.run != null and App.inst.screen_name != "title":
			Session.run = null
			Router.go(true)
	await _settle(0.5)
	var p := MqMeta.new_profile()
	p.tutorialDone = true
	p.xp = 420
	p.runs = 1
	p.unlocked.commanders = ["r_huojin", "b_shiyun", "g_qingsi", "y_xuanji"]
	p.ascension = {"r_huojin": 3}
	p.commanderStats = {"r_huojin": {"runs": 1, "wins": 0, "bestFloor": 9, "highestAsc": 0}}
	p.history = [{"seed": "UITOUR", "commander": "r_huojin", "lieutenant": null, "ascension": 0, "result": "lose", "act": 1, "floor": 9, "score": 120, "date": 1790000000000, "deck": [], "relics": [], "nemesis": null, "turns": 40, "maxDamage": 30}]
	for k in ["cards", "enemies", "relics"]:
		p.discovered[k] = []
	var ci := 0
	for id in MqContent.cards:
		ci += 1
		if ci % 2 == 0:
			p.discovered.cards.append(id)
	for id in MqContent.enemies:
		if MqContent.enemies[id].act <= 2:
			p.discovered.enemies.append(id)
	var ri := 0
	for id in MqContent.relics:
		ri += 1
		if ri % 3 != 0:
			p.discovered.relics.append(id)
	Session.profile = p
	Session.run = null

	await page("title", func(): Router.show("title"))
	for tab in Settings.TABS:
		await page("settings_" + tab[0], func():
			var m := Settings.open()
			var b: Settings = m.body.get_child(0)
			b.tab = tab[0]
			b.render())
		await _close()
	await page("credits", func(): Credits.open(), 1.2)
	await _close()
	await page("select", func(): Router.show("select"))
	await page("select_locked_tip", func(): _hover_first(func(c): return c is Panel and c.theme_type_variation == "PanelTileBg" and c.get_child_count() > 0 and (c.get_child(c.get_child_count() - 1) is Label) and (c.get_child(c.get_child_count() - 1) as Label).text == "？？？"))
	for tab in Codex.TABS:
		await page("codex_" + tab[0], func():
			if App.inst.screen_name != "codex":
				Router.show("codex")
				await _settle(0.5)
			var panel := _find(App.inst.screen, func(n): return n is Codex) as Codex
			if panel != null:
				panel.tab = tab[0]
				panel.render(), 1.0)

	# a fresh seeded run
	Session.start_run("r_huojin", 0, "UITOUR")
	var r: Dictionary = Session.run
	await page("map_act_intro", _route, 1.4)
	MqRun.run_act(r, {"t": "proceed"})
	await page("map_start", _route)
	await page("map_tooltip", func(): _hover_first(func(c): return c.get_parent() is MapGraph))
	await page("deck", func(): DeckView.open(r.deck, "牌组"))
	await _close()
	await page("inspect_card", func(): DeckView.inspect("g_heartwood_pendant", false))
	await _close()
	await page("inspect_upgraded", func(): DeckView.inspect("r_basic_strike", true))
	await _close()
	await page("codex_modal", func(): Codex.open_modal(), 1.2)
	await _close()
	await page("settings_in_run", func():
		var m := Settings.open()
		var b: Settings = m.body.get_child(0)
		b.tab = "general"
		b.render())
	await _close()
	r.potions[0] = MqContent.potions.keys()[0]
	r.relics.append({"id": MqContent.relics.keys()[5]})
	await page("potion_menu", func():
		(App.inst.screen as RunScreen).top.refresh()
		PotionMenu.open(0, func(): pass))
	await _close()
	await page("relic_list", func(): RelicList.open(r))
	await _close()
	var first = null
	for nd in MqRun.available_nodes(r):
		if nd.type == "combat":
			first = nd
			break
	if first != null:
		MqRun.run_act(r, {"t": "go", "row": first.row, "col": first.col})
		await page("combat_placeholder", _route)
	var c := MqContent
	await _force(r, "reward", {"k": "reward", "items": [{"k": "gold", "n": 25, "taken": false}, {"k": "relic", "id": c.relics.keys()[3], "taken": false},
		{"k": "potion", "id": c.potions.keys()[0], "taken": false}, {"k": "cards", "options": [{"uid": 901, "id": "r_basic_strike", "up": false}, {"uid": 902, "id": "g_heartwood_pendant", "up": false}, {"uid": 903, "id": "b_basic_guard", "up": true}], "taken": false}]})
	await page("reward_card_choice", func():
		var scr = App.inst.screen
		scr._card_choice(3, r.screen.items[3].options))
	await _close()
	await page("reward_leave_confirm", func(): App.inst.screen._proceed())
	await _close()
	var boss_relics: Array = []
	for x in c.relics.values():
		if x.tier == "boss" and boss_relics.size() < 3:
			boss_relics.append(x.id)
	await _force(r, "boss_relic", {"k": "bossRelic", "options": boss_relics})
	await _force(r, "shop", {"k": "shop", "shop": MqRun.make_shop(r)})
	await _force(r, "camp", {"k": "camp", "done": false})
	await _force(r, "recruit", {"k": "recruit", "options": MqRun.roll_lieutenants(r), "done": false})
	await page("recruit_explain", func(): App.inst.screen._explain(c.lieutenants[r.screen.options[0]], 0))
	await _close()
	await _force(r, "stargaze", {"k": "stargaze", "done": false})
	await page("stargaze_suit_pick", func():
		App.inst.screen.sel = 0
		App.inst.screen._do("change"))
	await _close()
	await _force(r, "stargaze_preview", {"k": "stargaze", "done": true, "preview": [{"row": 3, "col": 1, "label": "精英 · 锈甲将军"}, {"row": 4, "col": 2, "label": "事件：残破观星台"}]})
	await _force(r, "chest_closed", {"k": "chest", "relic": c.relics.keys()[0], "gold": 30, "opened": false})
	await _force(r, "chest", {"k": "chest", "relic": c.relics.keys()[0], "gold": 30, "opened": true})
	await _force(r, "pick_upgrade", {"k": "pick", "kind": "upgrade", "n": 1, "optional": false, "source": "camp"})
	await _force(r, "pick_remove_optional", {"k": "pick", "kind": "remove", "n": 1, "optional": true, "source": "shop"})
	await _force(r, "card_choice", {"k": "cardChoice", "options": [{"uid": 911, "id": "r_basic_strike", "up": false}, {"uid": 912, "id": "g_heartwood_pendant", "up": false}, {"uid": 913, "id": "b_basic_guard", "up": false}], "n": 1})
	var evs: Array = c.events.values()
	var ecount := evs.size() if events_limit < 0 else mini(events_limit, evs.size())
	for i in ecount:
		await _force(r, "event_" + evs[i].id, {"k": "event", "id": evs[i].id, "page": null})
	await _force(r, "event_outcome", {"k": "event", "id": evs[0].id, "page": null, "outcome": "你在碑前站了很久。风把[灼烧]的余烬吹散，碑上的名字却更清晰了。"})
	r.pos = {"row": 8, "col": r.map.rows[8][0].col}
	await _force(r, "map_row9", {"k": "map"})
	for act in [2, 3, 4]:
		var r2 = MqRun.new_run({"seed": "UITOUR%d" % act, "commander": "b_shiyun", "ascension": 2})
		while r2.act < act:
			MqRun.advance_act(r2)
		r2.screen = {"k": "map"}
		Session.run = r2
		await page("map_act%d" % act, _route)
	Session.run = r
	Session.last_unlocks = ["逆命 1 已开放（火烬）", "石韫、青姒 加入"]
	r.result = "win"
	r.flags.append("huojin_carved_legion")
	await _force(r, "victory", {"k": "victory"})
	r.result = "lose"
	r.nemesis = c.encounters.keys()[0]
	await _force(r, "defeat", {"k": "defeat"})
	r.result = null
	await _force(r, "hidden_choice", {"k": "hiddenChoice"})
	_finish()

func _find(root: Node, pred: Callable) -> Node:
	if root == null:
		return null
	for ch in root.get_children():
		if pred.call(ch):
			return ch
		var f := _find(ch, pred)
		if f != null:
			return f
	return null

func _hover_first(pred: Callable) -> void:
	for a in Tip.anchors:
		if is_instance_valid(a) and a.is_visible_in_tree() and pred.call(a):
			a.mouse_entered.emit()
			return

# ───────────── checks ─────────────

func _visible(c: CanvasItem) -> bool:
	if not c.is_visible_in_tree():
		return false
	var n: Node = c
	while n != null:
		if n is CanvasItem and (n.modulate.a < 0.05 or n.self_modulate.a < 0.05 and n == c):
			return false
		n = n.get_parent()
	return true

func _all(root: Node, out: Array) -> Array:
	for ch in root.get_children(true):
		out.append(ch)
		_all(ch, out)
	return out

func _in_scroll(c: Node) -> bool:
	var n := c.get_parent()
	while n != null:
		if n is ScrollContainer:
			return true
		n = n.get_parent()
	return false

func _rect(c: Control) -> Rect2:
	return Tip.anchor_rect(c)

func _label_text(c: Control) -> String:
	if c is Label:
		return c.text
	if c is RichTextLabel:
		return c.get_parsed_text()
	return ""

func _layers() -> Array:
	var roots: Array = []
	if Modal.top() != null:
		roots.append(App.inst.modals)
	else:
		roots.append(App.inst.host)
		roots.append(App.inst.toasts)
	roots.append(App.inst.tips)
	return roots

func _name(c: Control) -> String:
	var t := _label_text(c).replace("\n", " ")
	return "\"%s\"" % t.substr(0, 24) if t != "" else c.get_class()

func check() -> Array:
	var issues: Array = []
	var nodes: Array = []
	for root in _layers():
		_all(root, nodes)
	var texts: Array = []
	var v := Layout.view
	for n in nodes:
		if not (n is Label or n is RichTextLabel) or not _visible(n):
			continue
		var t := _label_text(n)
		if t.strip_edges() == "":
			continue
		texts.append(n)
		if _re_var.search(t) != null:
			issues.append({"kind": "unfilled", "detail": "%s shows a {var} placeholder" % _name(n)})
		for m in _re_en.search_all(t):
			if _re_allowed.search(t) == null:
				issues.append({"kind": "english", "detail": _name(n)})
				break
		var r := _rect(n)
		# clipped / overflowing text
		if n is Label:
			var lb := n as Label
			var font := lb.get_theme_font("font")
			var fsz := lb.get_theme_font_size("font_size")
			if lb.autowrap_mode == TextServer.AUTOWRAP_OFF:
				var w := 0.0
				for line in lb.text.split("\n"):
					w = maxf(w, font.get_string_size(line, HORIZONTAL_ALIGNMENT_LEFT, -1, fsz).x)
				if w > lb.size.x + 2.0:
					issues.append({"kind": "clipped", "detail": "%s needs %d px, has %d" % [_name(lb), int(w), int(lb.size.x)]})
			else:
				if lb.get_line_count() > lb.get_visible_line_count() and lb.max_lines_visible < 0:
					issues.append({"kind": "clipped", "detail": "%s shows %d of %d lines" % [_name(lb), lb.get_visible_line_count(), lb.get_line_count()]})
				var mw := 0.0
				for word in lb.text.split(" "):
					pass
			if lb.size.y + 2.0 < lb.get_minimum_size().y:
				issues.append({"kind": "clipped", "detail": "%s is %d px tall, needs %d" % [_name(lb), int(lb.size.y), int(lb.get_minimum_size().y)]})
		else:
			var rl := n as RichTextLabel
			var ch := rl.get_content_height()
			if ch > rl.size.y + 3.0:
				issues.append({"kind": "clipped", "detail": "%s rich text %d px tall in a %d px box" % [_name(rl), int(ch), int(rl.size.y)]})
		if not _in_scroll(n) and (r.position.x < v.position.x - 4 or r.position.y < v.position.y - 4 or r.end.x > v.end.x + 4 or r.end.y > v.end.y + 4):
			issues.append({"kind": "offscreen", "detail": "%s at %d,%d %dx%d" % [_name(n), int(r.position.x), int(r.position.y), int(r.size.x), int(r.size.y)]})
	# overlapping texts
	var boxes: Array = []
	for t in texts:
		if _in_scroll(t):
			continue
		var r := _rect(t)
		var k := 0.15
		boxes.append([t, Rect2(r.position + r.size * k, r.size * (1.0 - 2.0 * k))])
	for i in boxes.size():
		for j in range(i + 1, boxes.size()):
			var a: Rect2 = boxes[i][1]
			var b: Rect2 = boxes[j][1]
			if _label_text(boxes[i][0]) == _label_text(boxes[j][0]):
				continue
			var inter := a.intersection(b)
			var small := minf(a.get_area(), b.get_area())
			if small > 60.0 and inter.get_area() / small > 0.35:
				issues.append({"kind": "overlap", "detail": "%s overlaps %s" % [_name(boxes[i][0]), _name(boxes[j][0])]})
	# touch targets (phone)
	if Layout.is_phone():
		var tm := Layout.touch_min() - 1.0
		var screen_area := v.get_area()
		for n in nodes:
			if not (n is Control) or not _visible(n):
				continue
			var c := n as Control
			if c is ScrollContainer or c is RichTextLabel or c is Modal:
				continue
			var tappable := c is BaseButton or c is LineEdit or ((c is CardView or c is FateCard) and c.mouse_filter != Control.MOUSE_FILTER_IGNORE)
			if not tappable and c.mouse_filter != Control.MOUSE_FILTER_IGNORE:
				tappable = c.gui_input.get_connections().size() > 0 or (c.mouse_filter == Control.MOUSE_FILTER_STOP and c.mouse_entered.get_connections().size() > 0)
			if not tappable:
				continue
			var r := _rect(c)
			if r.get_area() > screen_area * 0.6:
				continue
			if r.size.x < tm or r.size.y < tm:
				issues.append({"kind": "touch", "detail": "%s %s is %dx%d (< %d)" % [c.get_class(), c.name, int(r.size.x), int(r.size.y), int(tm + 1)]})
	return issues

## hover every tooltip anchor of the page (up to 30): the tip must sit next to it and fully on screen
func check_tooltips() -> Array:
	var issues: Array = []
	var roots := _layers()
	var list: Array = []
	for a in Tip.anchors:
		if not is_instance_valid(a) or not _visible(a) or not _on_screen(a):
			continue
		for root in roots:
			if root.is_ancestor_of(a):
				list.append(a)
				break
	var v := Layout.view
	for a in list.slice(0, 30):
		a.mouse_entered.emit()
		await get_tree().process_frame
		await get_tree().process_frame
		var tip := Tip.current()
		if tip == null or not Tip.owner_is(a):
			continue
		var t := Rect2(tip.position, tip.size)
		var e := _rect(a)
		if e.size.x <= 520 and e.size.y <= 520:
			var dx := maxf(0.0, maxf(e.position.x - t.end.x, t.position.x - e.end.x))
			var dy := maxf(0.0, maxf(e.position.y - t.end.y, t.position.y - e.end.y))
			if Vector2(dx, dy).length() > 40.0:
				issues.append({"kind": "tooltip", "detail": "tooltip for %s is %d px away" % [a.name, int(Vector2(dx, dy).length())]})
		if t.position.x < v.position.x - 1 or t.position.y < v.position.y - 1 or t.end.x > v.end.x + 1 or t.end.y > v.end.y + 1:
			issues.append({"kind": "tooltip", "detail": "tooltip for %s leaves the screen" % a.name})
		# the tooltip's own text must not be clipped
		for n in _all(tip, []):
			if n is RichTextLabel and n.get_content_height() > n.size.y + 3.0:
				issues.append({"kind": "clipped", "detail": "tooltip text of %s" % a.name})
		Tip.hide()
	return issues

## the control is on screen (and not scrolled out of its scroll box)
func _on_screen(c: Control) -> bool:
	var r := _rect(c)
	var ctr := r.get_center()
	if not Layout.view.has_point(ctr):
		return false
	var n := c.get_parent()
	while n != null:
		if n is ScrollContainer and not Tip.anchor_rect(n).has_point(ctr):
			return false
		n = n.get_parent()
	return true

func _finish() -> void:
	var total := 0
	var bad := 0
	var lines: Array = []
	for p in pages:
		total += p.issues.size()
		if p.issues.size() > 0:
			bad += 1
			lines.append("■ " + p.name)
			for i in p.issues.slice(0, 14):
				lines.append("   %-9s %s" % [i.kind, i.detail])
			if p.issues.size() > 14:
				lines.append("   … %d more" % (p.issues.size() - 14))
	var win := DisplayServer.window_get_size()
	var head := "UI tour %dx%d (%s, view %dx%d): %d pages, %d with issues, %d issues" % [win.x, win.y, Layout.profile, int(Layout.view.size.x), int(Layout.view.size.y), pages.size(), bad, total]
	print(head)
	for l in lines:
		print(l)
	var f := FileAccess.open(out_dir.path_join("report.json"), FileAccess.WRITE)
	if f != null:
		f.store_string(JSON.stringify({"summary": head, "pages": pages}, " "))
	OS.remove_logger(logger)
	get_tree().quit(mini(total, 255))
