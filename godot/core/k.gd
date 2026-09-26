## Asset keys — same scheme as `K` in src/game/assets.ts.
class_name K
extends RefCounted

static func card(faction: String, id: String) -> String: return "cards/%s/%s" % [faction, id]
static func hero(id: String) -> String: return "heroes/" + id
static func enemy(id: String, boss := false) -> String: return ("bosses/" if boss else "enemies/") + id
static func relic(id: String) -> String: return "ui/relics/" + id
static func potion(id: String) -> String: return "ui/potions/" + id
static func icon(id: String) -> String: return "ui/icons/" + id
static func ui(id: String) -> String: return "ui/" + id
static func bg(id: String) -> String: return "backgrounds/" + id
static func event(id: String) -> String: return "backgrounds/events/" + id
static func fx(id: String) -> String: return "effects/" + id
static func emblem(f: String) -> String: return "frames/emblem_" + f
