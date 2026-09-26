## Rules rich text -> BBCode (port of the tokenizer in src/game/ui/richtext.ts):
##   [术语]            highlighted term (keyword / status tint, or the caller's term colour), a [url] meta the
##                     RichLabel turns into a glossary tooltip on hover
##   {a} {dmg} …       live values from the card vars: buffed = green, nerfed = red (VarInfo {value, base, better})
##   {R}{B}{G}{Y}{P}{N} school pip textures, {sun}{thunder}{moon}{mountain} suit textures, inline via [img]
##   {X}               a bold X
## A {word} left unfilled is kept as text and reported in Rich.warnings (the UI tour fails on it).
## Line breaking (CJK + kinsoku) is done by Godot's text server.
class_name Rich
extends RefCounted

const PIPS := ["R", "B", "G", "Y", "P", "N"]
const SUITS := ["sun", "moon", "thunder", "mountain"]
const BUFF := Color8(0x1f, 0x8a, 0x3a)
const NERF := Color8(0xc0, 0x28, 0x1c)
const BUFF_LIGHT := Color8(0x9a, 0xff, 0x8a)
const NERF_LIGHT := Color8(0xff, 0x8a, 0x6a)

static var warnings: Array = []
static var _re_word: RegEx

static func esc(s: String) -> String:
	return s.replace("[", "[lb]")

## o: color (Color, base text), term_color (Color, overrides keyword tints), vars ({k: {value, base, better?}}),
##    size (font size, for the inline icons), light (bool: buff/nerf colours for dark backgrounds)
static func bbcode(text: String, o: Dictionary = {}) -> String:
	if _re_word == null:
		_re_word = RegEx.create_from_string("^\\w+$")
	var base: Color = o.get("color", C.text_dark)
	var size: int = int(o.get("size", 22))
	var vars: Dictionary = o.get("vars", {})
	var light: bool = o.get("light", false)
	var out := ""
	var i := 0
	var n := text.length()
	while i < n:
		var ch := text[i]
		if ch == "[":
			var j := text.find("]", i)
			if j > i:
				var name := text.substr(i + 1, j - i - 1)
				var col = o.get("term_color")
				if col == null:
					col = UiGloss.term_tint(name)
				if col == null:
					col = Color8(0x7a, 0x3a, 0x10) if not light else C.term
				out += "[url=term:%s][b][color=%s]%s[/color][/b][/url]" % [name, C.html(col), esc(name)]
				i = j + 1
				continue
		if ch == "{":
			var j := text.find("}", i)
			if j > i:
				var key := text.substr(i + 1, j - i - 1)
				if PIPS.has(key):
					out += _img(Assets.path_of(K.ui("pip_" + key)), size)
					i = j + 1
					continue
				if SUITS.has(key):
					out += _img(Assets.path_of(K.ui("suit_" + key)), int(size * 1.05))
					i = j + 1
					continue
				if key == "X" or key == "x":
					out += "[b][color=%s]X[/color][/b]" % C.html(base)
					i = j + 1
					continue
				if vars.has(key):
					var v: Dictionary = vars[key]
					var col := base
					var better: String = v.get("better", "higher")
					if v.value != v.base:
						var up: bool = (v.value > v.base) == (better == "higher")
						col = (BUFF_LIGHT if up else NERF_LIGHT) if light else (BUFF if up else NERF)
					out += "[b][color=%s]%s[/color][/b]" % [C.html(col), MqU.js_string(v.value)]
					i = j + 1
					continue
				if _re_word.search(key) != null and warnings.size() < 200:
					warnings.append("{%s} in \"%s\"" % [key, text.substr(0, 30)])
		out += "[lb]" if ch == "[" else ch
		i += 1
	return "[color=%s]%s[/color]" % [C.html(base), out]

static func _img(path: String, size: int) -> String:
	if path == "":
		return ""
	return "[img=%dx%d]%s[/img]" % [size, size, path]

## card vars for the renderer: every var of the def, with live values where given
static func card_vars(def: Dictionary, live: Dictionary = {}) -> Dictionary:
	var out := {}
	var dv = def.get("vars")
	if dv is Dictionary:
		for k in dv:
			out[k] = live.get(k, {"value": dv[k], "base": dv[k]})
	return out
