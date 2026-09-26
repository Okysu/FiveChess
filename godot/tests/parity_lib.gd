## Parity helpers: canonical serialization (mirror of canon()/canonCombat()/canonRun() in scripts/export-parity.ts),
## JSON patch application (deltaEncode) and a readable structural diff (path + TS value + GD value).
class_name MqParity
extends RefCounted

## canonical form: Dictionary keys as Strings, null-valued keys dropped, arrays keep nulls, numbers unchanged
## (compared numerically), NaN/Infinity as strings — exactly what JSON.stringify(canon(x)) produces in TS
static func canon(v):
	match typeof(v):
		TYPE_NIL:
			return null
		TYPE_FLOAT:
			if is_nan(v):
				return "NaN"
			if is_inf(v):
				return "Infinity" if v > 0 else "-Infinity"
			if floor(v) == v and abs(v) <= MqU.MAX_SAFE:
				return int(v)
			return fbits(v)
		TYPE_DICTIONARY:
			var out = {}
			for k in v:
				var c = canon(v[k])
				if c != null:
					out[String(k) if typeof(k) != TYPE_INT else str(k)] = c
			return out
		TYPE_ARRAY:
			var out = []
			out.resize(v.size())
			for i in v.size():
				out[i] = canon(v[i])
			return out
		TYPE_STRING_NAME:
			return String(v)
		TYPE_PACKED_INT32_ARRAY, TYPE_PACKED_INT64_ARRAY, TYPE_PACKED_FLOAT64_ARRAY, TYPE_PACKED_STRING_ARRAY:
			return canon(Array(v))
	return v

## exact IEEE-754 bits of a non-integer number, "#f" + 16 hex digits big-endian (same as fbits() in export-parity.ts)
static func fbits(v: float) -> String:
	var b = PackedFloat64Array([v]).to_byte_array()
	var h = "#f"
	for i in range(7, -1, -1):
		h += "%02x" % b[i]
	return h

static func unbits(s: String) -> float:
	var b = PackedByteArray()
	b.resize(8)
	for i in 8:
		b[7 - i] = s.substr(2 + i * 2, 2).hex_to_int()
	return b.decode_double(0)

static func canon_combat(s: Dictionary):
	var t: Dictionary = s.duplicate(false)
	t.erase("events")
	t.erase("log")
	t.erase("actions")
	t.erase("cfg")
	t.nActions = s.actions.size()
	return canon(t)

static func canon_run(r: Dictionary):
	var t: Dictionary = r.duplicate(false)
	t.erase("log")
	t.nLog = r.log.size()
	return canon(t)

## apply deltaEncode ops to `root` (mutated); returns the (possibly replaced) root
static func apply_patch(root, ops: Array):
	for op in ops:
		var path: Array = op[0]
		if path.is_empty():
			root = MqU.clone(op[1])
			continue
		var node = root
		for i in path.size() - 1:
			node = node[path[i]]
		var last = path[path.size() - 1]
		if op.size() == 1:
			if node is Dictionary:
				node.erase(last)
		else:
			node[last] = MqU.clone(op[1])
	return root

static func _is_num(v) -> bool:
	return typeof(v) == TYPE_INT or typeof(v) == TYPE_FLOAT

static func short(v, n := 240) -> String:
	var s = JSON.stringify(v)
	if typeof(v) == TYPE_NIL:
		s = "<missing>"
	elif typeof(v) == TYPE_STRING and v.begins_with("#f") and v.length() == 18:
		s = "%s (%.17f)" % [v, unbits(v)]
	return s if s.length() <= n else s.substr(0, n) + "…"

## first differences between expected (TS) and actual (GD) canonical values -> ["path: TS=… GD=…"]
static func diff(exp, act, path := "$", out: Array = [], limit := 6) -> Array:
	if out.size() >= limit:
		return out
	if _is_num(exp) and _is_num(act):
		if float(exp) != float(act):
			out.append("%s: TS=%s GD=%s" % [path, short(exp), short(act)])
		return out
	if typeof(exp) != typeof(act):
		out.append("%s: TS=%s GD=%s" % [path, short(exp), short(act)])
		return out
	match typeof(exp):
		TYPE_DICTIONARY:
			for k in exp:
				if not act.has(k):
					out.append("%s.%s: TS=%s GD=<missing>" % [path, k, short(exp[k])])
				else:
					diff(exp[k], act[k], "%s.%s" % [path, k], out, limit)
				if out.size() >= limit:
					return out
			for k in act:
				if not exp.has(k):
					out.append("%s.%s: TS=<missing> GD=%s" % [path, k, short(act[k])])
					if out.size() >= limit:
						return out
		TYPE_ARRAY:
			if exp.size() != act.size():
				out.append("%s: length TS=%d GD=%d  TS=%s GD=%s" % [path, exp.size(), act.size(), short(exp, 400), short(act, 400)])
				return out
			for i in exp.size():
				diff(exp[i], act[i], "%s[%d]" % [path, i], out, limit)
				if out.size() >= limit:
					return out
		_:
			if exp != act:
				out.append("%s: TS=%s GD=%s" % [path, short(exp), short(act)])
	return out
