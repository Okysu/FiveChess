## Boot / loading (src/main.ts boot()): content → save data → every UI texture + icon (the UI is built only from
## generated woodblock art) → title (or the resumed run).
extends Screen

func enter() -> void:
	App.inst.set_backdrop("")
	(%Logo as TextureRect).texture = Wb.tex("logo")
	(%Bar as WbBar).set_color("gold")
	(%Bar as WbBar).set_value(0.0)

func shown() -> void:
	_progress(0.05, "展开命书……")
	await get_tree().process_frame
	MqContent.load_all()
	_progress(0.15, "点亮星灯……")
	await get_tree().process_frame
	Session.load_all()
	_progress(0.25, "研墨……")
	var ui: Array = []
	for id in Wb.UI_TEXTURES:
		ui.append(K.ui(id))
	await Assets.load_many(ui, func(k): _progress(0.25 + k * 0.4, "唤醒执命者……"))
	var more: Array = Assets.keys_by_prefix("ui/icons/")
	more.append(K.bg("title"))
	for id in ["ember", "spark", "smoke", "ink_splash", "petal", "leaf", "frost", "glow", "ring", "flame", "slash", "rune"]:
		more.append(K.fx(id))
	await Assets.load_many(more, func(k): _progress(0.65 + k * 0.3, "点燃灯火……"))
	_progress(1.0, "")
	await get_tree().process_frame
	Router.go(true)

func _progress(k: float, msg: String) -> void:
	(%Bar as WbBar).set_value(k)
	if msg != "":
		(%Msg as Label).text = msg
