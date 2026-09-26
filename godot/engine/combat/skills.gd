## Port of src/engine/combat/skills.ts
class_name MqSkills
extends RefCounted

static func skill_def(s: Dictionary, sk: Dictionary):
	var base = null
	if sk.from == "commander":
		for x in MqContent.commander(s.cfg.commander).skills:
			if x.id == sk.id:
				base = x
				break
	elif MqU.truthy(s.cfg.get("lieutenant")):
		var l = MqContent.lieutenants.get(s.cfg.lieutenant)
		if l != null and l.skill.id == sk.id:
			base = l.skill
	if base == null:
		return null
	if sk.awakened and base.get("awaken") != null and base.awaken.get("becomes") != null:
		var d: Dictionary = base.awaken.becomes.duplicate(false)
		d.id = base.id
		return d
	return base
