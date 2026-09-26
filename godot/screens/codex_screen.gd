## 图鉴 screen (CodexScene in src/game/scenes/codex.ts): back plate, carved title, the codex panel in a woodblock frame.
extends Screen

func enter() -> void:
	App.inst.set_backdrop(K.bg("codex"), Color8(0x6a, 0x6a, 0x6a))
	Audio.play_music("camp")
	(%Back as WbButton).pressed.connect(func(): Router.show("title"))
	var p: Codex = load(Layout.scene_dir() + "codex_panel.tscn").instantiate()
	p.size_flags_vertical = Control.SIZE_EXPAND_FILL
	(%Frame as Container).add_child(p)

func on_back() -> bool:
	Router.show("title")
	return true
