## Shared base for run screens (RunScreen in src/game/scenes/common.ts): backdrop, music, dim, the top bar (edge
## anchored, full width at any aspect), the heading and the bottom-right continue button.
## Variant skeleton conventions (all optional): %Heading (Label), %Continue (WbButton, hidden until used),
## %Dim (TextureRect, the ink dim), %Content (the container the screen fills).
class_name RunScreen
extends Screen

var top: TopBar
var run: Dictionary

## o: bg (backdrop id), music (mood), tint (Color), heading (String), dim (float)
func setup(o: Dictionary) -> void:
	run = Session.run
	App.inst.set_backdrop(K.bg(o.get("bg", "")), o.get("tint", Color.WHITE))
	if o.has("music"):
		Audio.play_music(o.music)
	var d := part("Dim") as TextureRect
	if d != null:
		d.texture = Wb.tex("dim_vignette")
		d.modulate = Color(1, 1, 1, o.get("dim", 0.0))
		d.visible = o.get("dim", 0.0) > 0.0
	top = TopBar.create(run, {
		"on_potion": _on_potion,
		"on_settings": func(): Settings.open(),
		"on_codex": func(): Codex.open_modal(),
	})
	add_child(top)
	var h := part("Heading") as Label
	if h != null:
		h.text = o.get("heading", "")
		h.visible = h.text != ""

## the bottom-right continue plate of the variant (%Continue)
func continue_button(text: String, on_press: Callable) -> WbButton:
	var b := part("Continue") as WbButton
	if b == null:
		b = WbButton.make(text, "primary", Vector2(280, 76), 32)
		b.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_RIGHT, Control.PRESET_MODE_MINSIZE, 40)
		add_child(b)
	b.text = text
	b.visible = true
	for c in b.pressed.get_connections():
		b.pressed.disconnect(c.callable)
	b.pressed.connect(on_press)
	return b

## potion slot tapped in the top bar (outside combat: use if it works on the map, or discard)
func _on_potion(i: int) -> void:
	PotionMenu.open(i, func(): top.refresh())

func on_back() -> bool:
	return false
