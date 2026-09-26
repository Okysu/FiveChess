## Base of every screen scene (Scene in src/game/core/app.ts). The screen's .tscn (desktop or phone variant) holds the
## layout skeleton — anchors, margins and containers with unique names — and the shared script fills it in enter().
class_name Screen
extends Control

var params := {}

## build the screen; runs while the transition curtain is down (may await)
func enter() -> void:
	pass

## runs once the curtain has lifted (intros, anything the player must see)
func shown() -> void:
	pass

func exit() -> void:
	pass

## Esc / back; return true when handled
func on_back() -> bool:
	return false

## a node by unique name (%Name) or null when this variant has no such node
func part(n: String) -> Node:
	return get_node_or_null("%" + n)
