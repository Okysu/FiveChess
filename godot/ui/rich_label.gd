## RichTextLabel for rules text (see Rich): BBCode on, sized to its content, [term] metas show the glossary tooltip
## next to the label on hover. `fit(max_h, min_size)` shrinks the font until the text fits a fixed box (card rules).
class_name RichLabel
extends RichTextLabel

var source := ""
var opts := {}
var font_px := 22

func _init() -> void:
	bbcode_enabled = true
	fit_content = true
	scroll_active = false
	autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	meta_underlined = false
	hint_underlined = false
	selection_enabled = false
	mouse_filter = Control.MOUSE_FILTER_PASS
	meta_hover_started.connect(_on_meta_in)
	meta_hover_ended.connect(_on_meta_out)
	tree_exiting.connect(func(): if Tip.owner_is(self): Tip.hide())

## text: rules text with [terms] / {vars} / {pips}; o: Rich.bbcode options + size (unscaled px; Layout.fs applied unless
## raw), align ("left" | "center"), bold (use the bold font as the normal one), line (extra line separation)
static func make(text: String, o: Dictionary = {}) -> RichLabel:
	var r := RichLabel.new()
	r.set_rich(text, o)
	return r

func set_rich(text: String, o: Dictionary = {}) -> void:
	source = text
	opts = o
	var px: int = int(o.get("size", 22)) if o.get("raw", false) else Layout.fs(o.get("size", 22))
	_apply(px)

func _apply(px: int) -> void:
	font_px = px
	for k in ["normal_font_size", "bold_font_size", "italics_font_size", "bold_italics_font_size"]:
		add_theme_font_size_override(k, px)
	if opts.get("bold", false):
		add_theme_font_override("normal_font", C.font("bold"))
		add_theme_font_override("bold_font", C.font("title"))
	if opts.has("line"):
		add_theme_constant_override("line_separation", int(opts.line))
	var o := opts.duplicate()
	o.size = px
	var code := Rich.bbcode(source, o)
	if opts.get("align", "left") == "center":
		code = "[center]" + code + "[/center]"
	text = code

## shrink the font (one px at a time, down to min_px) until the content fits max_h; needs a width
func fit(max_h: float, min_px: int) -> void:
	var px := font_px
	while px > min_px and get_content_height() > max_h:
		px -= 1
		_apply(px)

func _on_meta_in(meta) -> void:
	var m := str(meta)
	if m.begins_with("term:"):
		var lines := UiGloss.lines([m.trim_prefix("term:")])
		if not lines.is_empty():
			Tip.show_for(self, lines, 380, "right")

func _on_meta_out(_meta) -> void:
	Tip.hide()
