## Woodblock skin — port of src/game/ui/skin.ts. The ONLY way UI visuals are rendered: every visible element is a
## generated woodblock texture (assets/ui/*). No StyleBoxFlat, no draw_rect / draw_circle shapes, no gradients;
## until a texture exists the element is simply empty. Invisible geometry (clip rects, polygon UV windows for the
## art masks) and plain screen dims made from the ink texture are the only exceptions, like on the web.
class_name Wb
extends RefCounted

## every UI texture id the game uses (preloaded at boot)
const UI_TEXTURES := [
	"panel_light", "panel_dark", "panel_row", "panel_tile", "menu_panel", "topbar", "banner_band", "rules_box",
	"button_red", "button_green", "button_blue", "button_grey",
	"card_frame_R", "ribbon_R", "pip_R", "card_frame_B", "ribbon_B", "pip_B", "card_frame_G", "ribbon_G", "pip_G",
	"card_frame_Y", "ribbon_Y", "pip_Y", "card_frame_P", "ribbon_P", "pip_P", "card_frame_N", "ribbon_N", "pip_N",
	"cost_disc", "stat_atk", "stat_hp", "stat_dur", "stat_turns", "gem_common", "gem_rare", "gem_epic", "gem_legendary",
	"suit_sun", "suit_thunder", "suit_moon", "suit_mountain", "bar_frame", "bar_fill_red", "bar_fill_blue", "bar_fill_gold",
	"frame_gold", "frame_red", "frame_blue", "ring_gold", "ring_red", "token_frame", "tag_red", "tag_gold",
	"skill_disc", "skill_disc_active", "equip_slot", "slot", "altar", "seal_response", "ward_bubble", "frost_overlay", "smoke_overlay",
	"arrow_chevron", "arrow_head", "path_dot", "path_dot_red", "stamp_visited", "toggle_on", "toggle_off", "slider_track", "slider_knob",
	"logo", "card_back", "fate_back", "fate_face", "art_placeholder", "tex_paper", "tex_ink", "dim_vignette", "cloud_corner", "divider", "shopkeeper",
]

## 9-slice margins (fractions of the texture) and on-screen corner size — SLICES in skin.ts
const SLICES := {
	"panel_light": [0.2, 0.2, 0.26, 0.26, 64], "panel_dark": [0.2, 0.2, 0.26, 0.26, 64],
	"panel_row": [0.12, 0.12, 0.3, 0.3, 36], "panel_tile": [0.22, 0.22, 0.22, 0.22, 30],
	"menu_panel": [0.18, 0.18, 0.14, 0.14, 60], "topbar": [0.15, 0.15, 0.3, 0.4, 70],
	"banner_band": [0.14, 0.14, 0.3, 0.3, 80], "rules_box": [0.12, 0.12, 0.2, 0.2, 22],
	"button_red": [0.2, 0.2, 0.3, 0.3, 44], "button_green": [0.2, 0.2, 0.3, 0.3, 44],
	"button_blue": [0.2, 0.2, 0.3, 0.3, 44], "button_grey": [0.2, 0.2, 0.3, 0.3, 44],
	"ribbon": [0.2, 0.2, 0.3, 0.3, 50], "card_frame": [0.17, 0.17, 0.12, 0.12, 44],
	"bar_frame": [0.12, 0.12, 0.3, 0.3, 20], "bar_fill": [0.08, 0.08, 0.2, 0.2, 8],
	"frame": [0.2, 0.2, 0.14, 0.14, 30], "tag": [0.22, 0.22, 0.3, 0.3, 14],
	"equip_slot": [0.25, 0.25, 0.25, 0.25, 14], "slider_track": [0.1, 0.1, 0.3, 0.3, 14],
	"token_frame": [0.2, 0.2, 0.2, 0.12, 24],
}

## safe content inset inside each panel kind: the carved border + corner ornaments (INSET in skin.ts)
const INSET := {
	"dark": Vector2(60, 52), "light": Vector2(60, 52), "row": Vector2(64, 10), "tile": Vector2(22, 22), "menu": Vector2(90, 90),
}
const PANEL_TEX := {"dark": "panel_dark", "light": "panel_light", "row": "panel_row", "tile": "panel_tile", "menu": "menu_panel"}

## button plates per kind (PLATE in widgets.ts)
const PLATE := {"primary": "button_red", "danger": "button_red", "normal": "button_blue", "ghost": "button_green", "disabled": "button_grey"}

static func tex(id: String) -> Texture2D:
	return Assets.tex(K.ui(id))

static func icon_tex(id: String) -> Texture2D:
	return Assets.tex(K.icon(id))

static func _spec(id: String) -> Array:
	if id.begins_with("ribbon_"): return SLICES.ribbon
	if id.begins_with("card_frame_"): return SLICES.card_frame
	if id.begins_with("bar_fill_"): return SLICES.bar_fill
	if id.begins_with("frame_"): return SLICES.frame
	if id.begins_with("tag_"): return SLICES.tag
	return SLICES.get(id, [0.2, 0.2, 0.2, 0.2, 24])

## a StyleBoxNine for a texture id; `o`: corner_scale, modulate, shadow, offset, expand, margins (Vector2 content inset)
static func nine(id: String, o: Dictionary = {}) -> StyleBoxNine:
	var s := StyleBoxNine.new()
	var sp := _spec(id)
	s.texture = tex(id)
	s.slice_l = sp[0]
	s.slice_r = sp[1]
	s.slice_t = sp[2]
	s.slice_b = sp[3]
	s.corner = float(sp[4]) * float(o.get("corner_scale", 1.0))
	s.modulate = o.get("modulate", Color.WHITE)
	s.shadow = o.get("shadow", false)
	s.offset = o.get("offset", Vector2.ZERO)
	s.expand = o.get("expand", 0.0)
	var m: Vector2 = o.get("margins", Vector2.ZERO)
	s.content_margin_left = m.x
	s.content_margin_right = m.x
	s.content_margin_top = m.y
	s.content_margin_bottom = m.y
	return s

## a panel style of one of the kinds dark / light / row / tile / menu, content margins = INSET (scaled with the corners)
static func panel(kind: String, corner_scale := 1.0, extra := Vector2.ZERO) -> StyleBoxNine:
	return nine(PANEL_TEX[kind], {"corner_scale": corner_scale, "margins": INSET[kind] * corner_scale + extra})

## a full-screen dim made from the ink texture
static func dim_rect(alpha: float) -> TextureRect:
	var t := TextureRect.new()
	t.texture = tex("dim_vignette")
	t.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	t.stretch_mode = TextureRect.STRETCH_SCALE
	t.modulate = Color(1, 1, 1, alpha)
	t.set_anchors_preset(Control.PRESET_FULL_RECT)
	return t

## a texture fitted into (size) keeping its aspect, centred
static func sprite(id_or_tex, size: Vector2, o: Dictionary = {}) -> TextureRect:
	var t := TextureRect.new()
	t.texture = id_or_tex if id_or_tex is Texture2D else tex(String(id_or_tex))
	t.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	t.stretch_mode = TextureRect.STRETCH_SCALE if o.get("stretch", false) else TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	t.custom_minimum_size = size
	t.size = size
	t.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if o.has("modulate"):
		t.modulate = o.modulate
	if o.has("self_modulate"):
		t.self_modulate = o.self_modulate
	return t

## icon from the generated icon set (assets/ui/icons), no fallback
static func icon(id: String, size: float, o: Dictionary = {}) -> TextureRect:
	return sprite(icon_tex(id), Vector2(size, size), o)

## a school resource token; `empty` shows a faded version for a missing colour
static func pip(color: String, size: float, empty := false) -> Control:
	var t := sprite("pip_" + color, Vector2(size, size), {"modulate": Color(0.353, 0.314, 0.282, 0.55)} if empty else {})
	return _with_glyph(t, {"R": "赤", "B": "玄", "G": "青", "Y": "金", "P": "紫", "N": "素"}[color], size)

static func suit_icon(s: String, size: float) -> Control:
	return _with_glyph(sprite("suit_" + s, Vector2(size, size)), {"sun": "日", "thunder": "雷", "moon": "月", "mountain": "山"}[s], size)

## 色觉模式: sources and suits also carry their name glyph, so nothing depends on hue alone
static var color_glyphs := false

static func _with_glyph(c: TextureRect, ch: String, size: float) -> Control:
	if not color_glyphs or size < 18:
		return c
	var l := Label.new()
	l.text = ch
	l.add_theme_font_override("font", C.font("title"))
	l.add_theme_font_size_override("font_size", int(round(size * 0.5)))
	l.add_theme_color_override("font_color", Color.WHITE)
	l.add_theme_color_override("font_outline_color", Color.BLACK)
	l.add_theme_constant_override("outline_size", maxi(3, int(size * 0.12)))
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	l.set_anchors_preset(Control.PRESET_FULL_RECT)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	c.add_child(l)
	return c

static func gem_id(rarity: String) -> String:
	return {"legendary": "gem_legendary", "epic": "gem_epic", "rare": "gem_rare"}.get(rarity, "gem_common")
