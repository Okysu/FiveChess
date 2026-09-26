## ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
##  PHASE 2 PLACEHOLDER — the real combat screen (board, hand, fate, response windows; src/game/scenes/combat/*) is
##  built in phase 2. This stand-in keeps a full run navigable end to end: it shows the encounter and resolves the
##  fight with the engine's greedy bot (MqSim.fight_loop → MqAuto, the same policy the balance simulator uses), one
##  bot turn per frame, then hands the result to the run layer via Session.finish_combat() exactly like the web.
##  Session.ensure_combat() / finish_combat(), the top bar hooks (on_hp / potions / on_map) and Router's "combat"
##  route are the plug-in points phase 2 builds on.
## ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
extends RunScreen

var _s = null
var _io = null
var _running := false
var _guard := 0

func enter() -> void:
	var sc: Dictionary = Session.run.screen
	var tier: String = sc.get("tier", "normal")
	setup({"bg": "battle_%d" % mini(4, Session.run.act), "music": "boss" if tier == "boss" else "elite" if tier == "elite" else "battle", "dim": 0.45,
		"heading": "「 首 领 战 」" if tier == "boss" else "「 精 英 战 」" if tier == "elite" else "「 遭 遇 战 」"})
	_s = Session.ensure_combat()
	var enc = MqContent.encounters.get(sc.encounter)
	var row := %Enemies as HBoxContainer
	var ph := Layout.is_phone()
	if enc != null:
		for e in enc.enemies:
			var ed = MqContent.enemies.get(e.id)
			if ed == null:
				continue
			var col := U.vbox(6)
			var t := Assets.tex(K.enemy(ed.id, ed.tier == "boss"))
			var sz := Vector2(220, 300) * (1.2 if ph else 1.0)
			col.add_child(Wb.sprite(t, sz))
			var nm := U.label(ed.name, "NoteTitle", 26)
			nm.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			col.add_child(nm)
			Tip.attach(col, [{"title": ed.name, "body": ed.get("lore", "")}], 400)
			row.add_child(col)
	(%Note as Label).text = "战斗界面将在第二阶段实现。现在可由引擎托管（与平衡模拟器相同的出牌策略）自动打完这一战。"
	_log("第 %d 回合 · 我方生命 %d" % [_s.turn, _hp()])
	(%Auto as WbButton).pressed.connect(_start)

func _hp() -> int:
	var pc = _s.units.get(_s.sides.player.commander)
	return pc.hp if pc != null else 0

func _log(t: String) -> void:
	(%Log as Label).text = t

func _start() -> void:
	if _running:
		return
	_running = true
	(%Auto as WbButton).disabled = true
	_io = MqSim.DefaultIO.new()
	MqSim.answer_all(_s, _io)

func _process(_d: float) -> void:
	if not _running or _s == null:
		return
	if _s.over == null and _guard <= 60:
		_guard += 1
		var turn: int = _s.turn
		_io.play_turn(_s, _io)
		MqSim.answer_all(_s, _io)
		if _s.phase == "main" and _s.over == null and _s.turn == turn:
			_io.combat_act(_s, {"type": "endTurn"}, "end")
		MqSim.answer_all(_s, _io)
		_log("第 %d 回合 · 我方生命 %d" % [_s.turn, _hp()])
		top.refresh()
		return
	_running = false
	if _s.over == null:
		_s.over = "lose"
	var win: bool = _s.over == "win"
	_log("胜利！剩余生命 %d" % _hp() if win else "战败……")
	Audio.sfx("victory" if win else "defeat")
	var b := %Auto as WbButton
	b.visible = false
	continue_button("结算 →", func():
		Session.finish_combat()
		Router.go(true))
