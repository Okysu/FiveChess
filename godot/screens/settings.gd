## 设置 (src/game/scenes/settings.ts) as a modal usable anywhere. The body is a scene variant
## (scenes/<profile>/settings.tscn): desktop = tab column + rows, phone = tab row + scrolling rows with 48 dp controls.
## Variant metadata: tab_size, seg_size, toggle_size, slider_width, label_width.
class_name Settings
extends Control

var modal: Modal
var tab := "combat"

const TABS := [["general", "通用"], ["combat", "战斗"], ["display", "显示"], ["audio", "音频"], ["access", "辅助"]]

static func open() -> Modal:
	var m := Modal.open(Vector2(1500, 900), {"title": "设置"})
	var b: Settings = load(Layout.scene_dir() + "settings.tscn").instantiate()
	b.modal = m
	b.size_flags_vertical = Control.SIZE_EXPAND_FILL
	m.body.add_child(b)
	return m

func _ready() -> void:
	render()

func _meta(k: String, d):
	return get_meta(k, d)

func render() -> void:
	var tabs := %Tabs as BoxContainer
	U.clear(tabs)
	for t in TABS:
		var key: String = t[0]
		tabs.add_child(WbButton.make(t[1], "primary" if key == tab else "ghost", _meta("tab_size", Vector2(200, 64)), 30, func():
			tab = key
			render()))
	var rows := %Rows as VBoxContainer
	U.clear(rows)
	var st: Dictionary = Session.settings
	var save := func(): Session.save_settings()
	match tab:
		"combat":
			_row("演出速度", _seg(["1.0×", "1.5×", "2.0×"], [1, 1.5, 2].find(st.animSpeed), func(i): st.animSpeed = [1, 1.5, 2][i]; save.call()))
			_row("精简演出", _toggle(st.skipAnims, func(v): st.skipAnims = v; save.call()), "跳过非关键动画（判定翻牌与应对窗口仍保留）")
			_row("快速判定", _toggle(st.fastJudge, func(v): st.fastJudge = v; save.call()))
			_row("应对询问", _seg(["总是", "智能", "从不"], ["always", "smart", "never"].find(st.responseMode), func(i): st.responseMode = ["always", "smart", "never"][i]; save.call()), "智能：仅当应对可能改变结果时才打开窗口")
			_row("应对倒计时", _seg(["5秒", "8秒", "12秒", "无限"], [5, 8, 12, 0].find(st.responseTimer), func(i): st.responseTimer = [5, 8, 12, 0][i]; save.call()))
			_row("结束回合前确认", _toggle(st.confirmEndTurn, func(v): st.confirmEndTurn = v; save.call()), "仍有可用行动时二次确认")
			_row("新手提示", _toggle(st.tutorialHints, func(v): st.tutorialHints = v; save.call()))
		"audio":
			for pair in [["主音量", "master"], ["音乐", "music"], ["音效", "sfx"], ["环境音", "ambient"]]:
				var key: String = pair[1]
				_row(pair[0], _slider(float(st.volume[key]), func(v):
					st.volume[key] = v
					save.call()
					if key == "sfx": Audio.sfx("click")))
		"display":
			_row("屏幕震动", _seg(["关", "弱", "标准"], [0, 0.5, 1].find(st.screenShake), func(i): st.screenShake = [0, 0.5, 1][i]; save.call()))
			_row("伤害数字", _toggle(st.damageNumbers, func(v): st.damageNumbers = v; save.call()))
			if not OS.has_feature("mobile"):
				_row("全屏", _toggle(DisplayServer.window_get_mode() == DisplayServer.WINDOW_MODE_FULLSCREEN, func(v):
					DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN if v else DisplayServer.WINDOW_MODE_WINDOWED)))
			_row("界面布局", _seg(["自动", "桌面", "手机"], ["auto", "desktop", "phone"].find(st.get("profile", "auto")), func(i):
				st.profile = ["auto", "desktop", "phone"][i]
				save.call()), "自动：按屏幕尺寸选择；手机布局字号更大、按钮更易点按（调试用）")
		"access":
			_row("命纹显示文字", _toggle(st.suitText, func(v): st.suitText = v; save.call()), "在命纹图标角落加“日/雷/月/山”汉字（命纹本身已是色 + 形双编码）")
			_row("色觉模式", _seg(["标准", "红绿", "蓝黄"], ["none", "rg", "by"].find(st.colorblind), func(i): st.colorblind = ["none", "rg", "by"][i]; save.call()), "开启后，源与命纹上额外标注“赤玄青金紫素 / 日雷月山”字样，不再只靠颜色区分")
		_:
			var note := U.para("快捷键：空格/E 结束回合（应对窗口中为“不应对”） · 1–0 选择手牌 · D 牌组 · A 抽牌堆 · S 弃牌堆 · L 战报 · Esc 取消/设置 · 右键 检视", "Dim", 20)
			rows.add_child(note)
			var btns := U.hbox(30)
			rows.add_child(btns)
			var bs: Vector2 = _meta("wide_size", Vector2(280, 64))
			btns.add_child(WbButton.make("恢复默认设置", "ghost", bs, 26, func():
				Session.settings = Session.default_settings()
				save.call()
				render()))
			if Session.run != null:
				var row2 := U.hbox(30)
				rows.add_child(row2)
				row2.add_child(WbButton.make("放弃本次冒险", "danger", bs, 26, _confirm_abandon))
				row2.add_child(WbButton.make("保存并返回标题", "normal", bs, 26, func():
					modal.close()
					Session.save_run()
					Router.show("title")))

func _confirm_abandon() -> void:
	var c := Modal.open(Vector2(700, 340), {"title": "确定放弃？", "phone_full": false})
	c.body.add_child(U.para("本次冒险将按当前进度结算。", "Body", 24))
	c.body.add_child(U.spacer(false))
	c.buttons([
		WbButton.make("放弃", "danger", Vector2(220, 64), 28, func():
			c.close()
			modal.close()
			Session.abandon()
			Router.show("title")),
		WbButton.make("取消", "ghost", Vector2(220, 64), 28, func(): c.close()),
	])

func _row(text: String, ctrl: Control, hint := "") -> void:
	var rows := %Rows as VBoxContainer
	var h := U.hbox(24)
	var col := U.vbox(2)
	col.custom_minimum_size.x = _meta("label_width", 450.0)
	col.alignment = BoxContainer.ALIGNMENT_CENTER
	var l := U.label(text, "Body", 26)
	col.add_child(l)
	if hint != "":
		var hl := U.para(hint, "Dim", 17)
		hl.custom_minimum_size.x = _meta("label_width", 450.0)
		col.add_child(hl)
	h.add_child(col)
	ctrl.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	h.add_child(ctrl)
	rows.add_child(h)

func _toggle(v: bool, on: Callable) -> Control:
	var sz: Vector2 = _meta("toggle_size", Vector2(120, 60))
	var b := TextureButton.new()
	b.toggle_mode = true
	b.button_pressed = v
	b.texture_normal = Wb.tex("toggle_off")
	b.texture_pressed = Wb.tex("toggle_on")
	b.ignore_texture_size = true
	b.stretch_mode = TextureButton.STRETCH_KEEP_ASPECT_CENTERED
	b.custom_minimum_size = Vector2(sz.x, maxf(sz.y, Layout.touch_min()))
	b.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	b.toggled.connect(func(on_v: bool):
		Audio.sfx("click")
		on.call(on_v))
	return b

func _seg(opts: Array, cur: int, on: Callable) -> Control:
	var h := U.hbox(10)
	var sel := [maxi(0, cur)]
	var sz: Vector2 = _meta("seg_size", Vector2(140, 56))
	var btns: Array = []
	for i in opts.size():
		var b := WbButton.make(opts[i], "primary" if i == sel[0] else "ghost", sz, 22)
		var idx: int = i
		b.pressed.connect(func():
			sel[0] = idx
			for j in btns.size():
				btns[j].kind = "primary" if j == idx else "ghost"
			on.call(idx))
		btns.append(b)
		h.add_child(b)
	return h

func _slider(v: float, on: Callable) -> Control:
	var w: float = _meta("slider_width", 440.0)
	var h := U.hbox(24)
	var track := Control.new()
	track.custom_minimum_size = Vector2(w + 40, maxf(60.0, Layout.touch_min()))
	track.mouse_filter = Control.MOUSE_FILTER_STOP
	track.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var bar := Panel.new()
	bar.add_theme_stylebox_override("panel", Wb.nine("slider_track"))
	bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
	track.add_child(bar)
	var knob := Wb.sprite("slider_knob", Vector2(40, 40) * (1.5 if Layout.is_phone() else 1.0))
	track.add_child(knob)
	var pct := U.label("", "Heading", 24)
	pct.custom_minimum_size.x = 90
	var val := [v]
	var draw := func():
		var hh := track.custom_minimum_size.y
		bar.position = Vector2(20, hh / 2.0 - 13)
		bar.size = Vector2(w, 26)
		knob.position = Vector2(20 + w * val[0] - knob.size.x / 2.0, hh / 2.0 - knob.size.y / 2.0)
		pct.text = "%d%%" % int(round(val[0] * 100))
	draw.call()
	var set_from := func(x: float):
		val[0] = clampf((x - 20.0) / w, 0.0, 1.0)
		draw.call()
		on.call(val[0])
	track.gui_input.connect(func(e: InputEvent):
		if e is InputEventMouseButton and e.button_index == MOUSE_BUTTON_LEFT and e.pressed:
			set_from.call(e.position.x)
		elif e is InputEventMouseMotion and (e.button_mask & MOUSE_BUTTON_MASK_LEFT) != 0:
			set_from.call(e.position.x))
	h.add_child(track)
	h.add_child(pct)
	return h
