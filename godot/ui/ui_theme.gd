## The game Theme, built in code at startup (and rebuilt when the layout profile flips, because font sizes follow
## Layout.fs()). Assigned to the root Window, so every screen stays declarative: a Label with
## theme_type_variation "Title" is a carved heading, a PanelContainer with "PanelDark" is the woodblock panel with the
## INSET content margins, etc. Only generated textures are used (StyleBoxNine / StyleBoxEmpty) — no StyleBoxFlat.
class_name UiTheme
extends RefCounted

## label variations: [font, size, colour, outline size, outline colour, shadow offset, shadow colour]
static func _label_specs() -> Dictionary:
	return {
		"Title": ["title", 48, C.gold_light, 6, C.wb_ink, 3, C.wb_vermilion_dk],
		"Heading": ["title", 28, C.gold_light, 0, C.black, 0, C.black],
		"HeadingOutline": ["title", 28, C.gold_light, 5, C.black, 0, C.black],
		"HeadingDim": ["title", 24, C.text_dim, 0, C.black, 0, C.black],
		"Body": ["body", 22, C.text, 0, C.black, 0, C.black],
		"Dim": ["body", 20, C.text_dim, 0, C.black, 0, C.black],
		"Small": ["body", 18, C.text_dim, 0, C.black, 0, C.black],
		"Note": ["body", 24, C.text, 5, C.black, 0, C.black],
		"NoteTitle": ["title", 30, C.text, 5, C.black, 0, C.black],
		"Num": ["num", 24, C.white, 5, C.black, 0, C.black],
		"BtnLabel": ["title", 30, C.wb_white, 6, C.wb_ink, 0, C.black],
		"BtnSub": ["bold", 15, C.wb_paper, 4, C.wb_ink, 0, C.black],
		"TipTitle": ["title", 24, C.gold_light, 0, C.black, 0, C.black],
		"Dark": ["bold", 22, C.text_dark, 0, C.black, 0, C.black],
	}

static func build() -> Theme:
	var t := Theme.new()
	var body := C.font("body")
	t.default_font = body
	t.default_font_size = Layout.fs(22)

	# Label
	t.set_color("font_color", "Label", C.text)
	t.set_font("font", "Label", body)
	t.set_font_size("font_size", "Label", Layout.fs(22))
	t.set_constant("line_spacing", "Label", 4)
	var specs := _label_specs()
	for name in specs:
		var s: Array = specs[name]
		t.set_type_variation(name, "Label")
		t.set_font("font", name, C.font(s[0]))
		t.set_font_size("font_size", name, Layout.fs(s[1]))
		t.set_color("font_color", name, s[2])
		if s[3] > 0:
			t.set_constant("outline_size", name, s[3])
			t.set_color("font_outline_color", name, s[4])
		if s[5] > 0:
			t.set_constant("shadow_offset_x", name, s[5])
			t.set_constant("shadow_offset_y", name, s[5])
			t.set_constant("shadow_outline_size", name, s[3])
			t.set_color("font_shadow_color", name, s[6])

	# panels (Panel + PanelContainer share the variations)
	var panels := {"PanelDark": Wb.panel("dark"), "PanelLight": Wb.panel("light"), "PanelRow": Wb.panel("row"),
		"PanelTile": Wb.panel("tile"), "PanelMenu": Wb.panel("menu"), "PanelTip": Wb.panel("dark", 0.5, Vector2(4, 4)),
		"PanelBanner": Wb.nine("banner_band", {"margins": Vector2(80, 20)}), "PanelTopbar": Wb.nine("topbar"),
		"PanelSlot": Wb.nine("equip_slot"), "PanelRules": Wb.nine("rules_box", {"margins": Vector2(24, 14)})}
	t.set_stylebox("panel", "PanelContainer", panels.PanelDark)
	t.set_stylebox("panel", "Panel", panels.PanelDark)
	for name in panels:
		t.set_type_variation(name, "PanelContainer")
		t.set_stylebox("panel", name, panels[name])
	for name in panels:
		var pv: String = name + "Bg"
		t.set_type_variation(pv, "Panel")
		t.set_stylebox("panel", pv, panels[name])

	# RichTextLabel
	t.set_font("normal_font", "RichTextLabel", body)
	t.set_font("bold_font", "RichTextLabel", C.font("bold"))
	t.set_font("italics_font", "RichTextLabel", body)
	t.set_font("bold_italics_font", "RichTextLabel", C.font("bold"))
	for k in ["normal_font_size", "bold_font_size", "italics_font_size", "bold_italics_font_size", "mono_font_size"]:
		t.set_font_size(k, "RichTextLabel", Layout.fs(22))
	t.set_color("default_color", "RichTextLabel", C.text)
	t.set_stylebox("normal", "RichTextLabel", StyleBoxEmpty.new())
	t.set_stylebox("focus", "RichTextLabel", StyleBoxEmpty.new())
	t.set_constant("line_separation", "RichTextLabel", 4)

	# plain Button fallback (the game uses WbButton): the printed plates
	for st in ["normal", "hover", "pressed", "focus", "disabled", "hover_pressed"]:
		var kind := "disabled" if st == "disabled" else "normal"
		t.set_stylebox(st, "Button", StyleBoxEmpty.new() if st == "focus" else Wb.nine(Wb.PLATE[kind], {"margins": Vector2(40, 12)}))
	t.set_font("font", "Button", C.font("title"))
	t.set_font_size("font_size", "Button", Layout.fs(26))
	t.set_color("font_color", "Button", C.wb_white)
	t.set_color("font_outline_color", "Button", C.wb_ink)
	t.set_constant("outline_size", "Button", 5)

	# LineEdit: the carved row plate
	var le := Wb.panel("row", 1.0, Vector2(0, 6))
	for st in ["normal", "focus", "read_only"]:
		t.set_stylebox(st, "LineEdit", le)
	t.set_font("font", "LineEdit", body)
	t.set_font_size("font_size", "LineEdit", Layout.fs(24))
	t.set_color("font_color", "LineEdit", C.text)
	t.set_color("font_placeholder_color", "LineEdit", C.text_dim)
	t.set_color("caret_color", "LineEdit", C.gold_light)
	t.set_color("selection_color", "LineEdit", Color(C.gold_dark, 0.6))

	# scroll containers: no procedural bars (WbScroll shows a slider_knob texture as the position indicator)
	t.set_stylebox("panel", "ScrollContainer", StyleBoxEmpty.new())
	for sb in ["VScrollBar", "HScrollBar"]:
		for st in ["scroll", "scroll_focus", "grabber", "grabber_highlight", "grabber_pressed"]:
			t.set_stylebox(st, sb, StyleBoxEmpty.new())

	# built-in tooltips (unused by the game UI, kept consistent)
	t.set_stylebox("panel", "TooltipPanel", panels.PanelTip)
	t.set_color("font_color", "TooltipLabel", C.body_light)
	t.set_font_size("font_size", "TooltipLabel", Layout.fs(18))

	# containers
	t.set_constant("separation", "HBoxContainer", 12)
	t.set_constant("separation", "VBoxContainer", 10)
	t.set_constant("h_separation", "GridContainer", 16)
	t.set_constant("v_separation", "GridContainer", 16)
	t.set_constant("h_separation", "HFlowContainer", 16)
	t.set_constant("v_separation", "HFlowContainer", 16)
	return t
