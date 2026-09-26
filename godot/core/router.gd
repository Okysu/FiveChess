## Routes the current run screen to its screen scene (port of src/game/router.ts): run.screen.k -> screen name.
## Screens live in res://scenes/<profile>/<name>.tscn (App.show_screen picks the variant).
extends Node

const ROUTES := {
	"map": "map", "actStart": "map",
	"combat": "combat",
	"reward": "reward", "bossRelic": "boss_relic",
	"shop": "shop", "camp": "camp", "event": "event", "recruit": "recruit", "stargaze": "stargaze", "chest": "chest",
	"pick": "pick", "cardChoice": "pick",
	"victory": "run_end", "defeat": "run_end", "hiddenChoice": "run_end",
}

var _current := ""

## show the screen for the current run state (title when there is no run)
func go(force := false) -> void:
	var r = Session.run
	if r == null:
		_current = "title"
		App.inst.show_screen("title")
		return
	var k: String = r.screen.k
	var key := "%s:%s:%s" % [k, r.floor, r.act]
	if not force and key == _current and App.inst.screen != null:
		return
	_current = key
	App.inst.show_screen(ROUTES.get(k, "map"))

## apply a run action, then route; returns null or the error code
func act(a: Dictionary):
	var err = Session.act(a)
	if err == null:
		go(true)
	return err

func show(name: String, params := {}) -> void:
	_current = name
	App.inst.show_screen(name, params)

func reset() -> void:
	_current = ""
