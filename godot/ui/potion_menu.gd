## Potion slot tapped outside combat (MapScene.usePotion in map.ts): use it if it works on the map, or discard it.
class_name PotionMenu
extends RefCounted

static func open(i: int, on_done: Callable) -> void:
	var r = Session.run
	if r == null or i >= r.potions.size() or r.potions[i] == null:
		return
	var id: String = r.potions[i]
	var def: Dictionary = MqContent.potions[id]
	var m := Modal.open(Vector2(700, 400), {"title": def.name, "phone_full": false})
	m.body.add_child(RichLabel.make(def.text, {"size": 22, "color": C.text, "light": true}))
	m.body.add_child(U.para("在地图上使用，或丢弃。" if def.get("outOfCombat") != null else "此物只能在战斗中使用。", "Dim", 22))
	m.body.add_child(U.spacer(false))
	var btns: Array = []
	if def.get("outOfCombat") != null:
		btns.append(WbButton.make("使用", "primary", Vector2(200, 64), 28, func():
			Session.act({"t": "mapPotion", "slot": i})
			m.close()
			Audio.sfx("heal")
			on_done.call()
			Router.go(true)))
	btns.append(WbButton.make("丢弃", "danger", Vector2(200, 64), 28, func():
		Session.act({"t": "discardPotion", "slot": i})
		m.close()
		on_done.call()))
	m.buttons(btns)
