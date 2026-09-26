## JS-semantics helpers shared by the whole port (no TS counterpart; replaces language built-ins).
##
## GDScript traps handled here:
##  - int / int truncates           -> callers use fdiv() (JS `/` is always float division)
##  - round() is half-away-from-zero -> js_round() (JS Math.round is half-up toward +inf)
##  - sort_custom is unstable         -> stable_sort() (JS Array.prototype.sort is stable)
##  - arr[-1] reads from the end      -> at() (JS out-of-range index is undefined)
##  - JSON.parse_string returns only floats -> json_norm() (integral floats become ints, like JS numbers)
##  - Array.find/has/== compare by value -> idx_same() for JS identity (===) lookups
##  - {} / [] are falsy in GDScript   -> callers test `!= null`, never truthiness, for object presence
class_name MqU
extends RefCounted

const MAX_SAFE := 9007199254740991.0

## JS Math.round
static func js_round(x) -> int:
	var f = float(x)
	var r = floor(f)
	if f - r >= 0.5:
		r += 1.0
	return int(r)

## JS Math.floor (result as int, like every integer-valued JS number the engine stores)
static func floori(x) -> int:
	return int(floor(float(x)))

## JS `/`
static func fdiv(a, b) -> float:
	return float(a) / float(b)

## JS `arr[i]` (undefined -> null for any out-of-range / negative / null index)
static func at(arr, i):
	if arr == null or i == null:
		return null
	var n: int = arr.size()
	var k = int(i)
	if typeof(i) == TYPE_FLOAT and float(k) != float(i):
		return null
	if k < 0 or k >= n:
		return null
	return arr[k]

## JS Array.prototype.slice(start, end)
static func js_slice(arr: Array, start = 0, end = null) -> Array:
	var n = arr.size()
	var s = int(start)
	if s < 0:
		s = max(n + s, 0)
	else:
		s = min(s, n)
	var e = n
	if end != null:
		e = int(end)
		if e < 0:
			e = max(n + e, 0)
		else:
			e = min(e, n)
	var out = []
	var i = s
	while i < e:
		out.append(arr[i])
		i += 1
	return out

## JS Array.prototype.splice(start, deleteCount?, ...items) — mutates arr, returns removed
static func js_splice(arr: Array, start, del = null, items: Array = []) -> Array:
	var n = arr.size()
	var s = int(start)
	if s < 0:
		s = max(n + s, 0)
	else:
		s = min(s, n)
	var d = n - s
	if del != null:
		d = clampi(int(del), 0, n - s)
	var removed = []
	for i in d:
		removed.append(arr[s])
		arr.remove_at(s)
	for i in items.size():
		arr.insert(s + i, items[i])
	return removed

## JS arr.pop() (undefined -> null)
static func pop(arr: Array):
	if arr.is_empty():
		return null
	return arr.pop_back()

## JS arr.shift()
static func shift(arr: Array):
	if arr.is_empty():
		return null
	return arr.pop_front()

## index of the element that IS x (JS indexOf / === on objects)
static func idx_same(arr: Array, x) -> int:
	for i in arr.size():
		if is_same(arr[i], x):
			return i
	return -1

## JS `a || b` style comparator composition helper: first non-zero
static func cmp_or(a, b):
	return b if a == 0 else a

## Stable merge sort with a JS comparator (negative => a first). Returns a new array.
static func stable_sort(arr: Array, cmp: Callable) -> Array:
	var a = arr.duplicate()
	var n = a.size()
	if n < 2:
		return a
	var tmp = a.duplicate()
	var width = 1
	while width < n:
		var lo = 0
		while lo < n:
			var mid = mini(lo + width, n)
			var hi = mini(lo + 2 * width, n)
			var i = lo
			var j = mid
			var k = lo
			while i < mid and j < hi:
				# take from the left run unless the right element must strictly come first
				if float(cmp.call(a[i], a[j])) <= 0.0:
					tmp[k] = a[i]
					i += 1
				else:
					tmp[k] = a[j]
					j += 1
				k += 1
			while i < mid:
				tmp[k] = a[i]
				i += 1
				k += 1
			while j < hi:
				tmp[k] = a[j]
				j += 1
				k += 1
			lo += 2 * width
		var t = a
		a = tmp
		tmp = t
		width *= 2
	return a

## in-place variant (JS arr.sort(cmp) mutates and returns arr)
static func sort_in_place(arr: Array, cmp: Callable) -> Array:
	var s = stable_sort(arr, cmp)
	for i in s.size():
		arr[i] = s[i]
	return arr

## JS default sort (no comparator): compares String(x) by UTF-16 code units (== code points for BMP text)
static func default_sort(arr: Array) -> Array:
	return sort_in_place(arr, func(a, b): return str_cmp(js_string(a), js_string(b)))

static func str_cmp(a: String, b: String) -> int:
	if a == b:
		return 0
	return -1 if a < b else 1

## JS String(x) for the values the engine stringifies
static func js_string(v) -> String:
	if v == null:
		return "null"
	if typeof(v) == TYPE_FLOAT:
		if float(int(v)) == v and abs(v) < MAX_SAFE:
			return str(int(v))
		return str(v)
	if typeof(v) == TYPE_BOOL:
		return "true" if v else "false"
	return str(v)

## JS arr.includes(x) for primitives
static func has(arr, x) -> bool:
	if arr == null:
		return false
	return arr.has(x)

## deep copy (structuredClone for JSON-like data; aliasing is NOT preserved — see MqAuto.clone_state)
static func clone(v):
	if v is Dictionary or v is Array:
		return v.duplicate(true)
	return v

## shallow object spread {...a}
static func spread(d: Dictionary) -> Dictionary:
	return d.duplicate(false)

## JSON text -> Variant with integral floats turned into ints (JS numbers have no int/float split; GDScript does,
## and ints are what the engine uses as Dictionary keys and array indices)
static func json_norm(v):
	match typeof(v):
		TYPE_FLOAT:
			if is_finite(v) and floor(v) == v and abs(v) < MAX_SAFE:
				return int(v)
			return v
		TYPE_DICTIONARY:
			var out = {}
			for k in v:
				out[k] = json_norm(v[k])
			return out
		TYPE_ARRAY:
			var out = []
			out.resize(v.size())
			for i in v.size():
				out[i] = json_norm(v[i])
			return out
	return v

static func read_json(path: String):
	var f = FileAccess.open(path, FileAccess.READ)
	if f == null:
		push_error("cannot open " + path)
		return null
	var txt = f.get_as_text()
	f.close()
	var j = JSON.new()
	if j.parse(txt) != OK:
		push_error("bad json " + path + ": " + j.get_error_message())
		return null
	return json_norm(j.data)

## JS Object.values sum for number maps
static func sum_values(d: Dictionary):
	var t = 0
	for k in d:
		var x = d[k]
		t += (0 if x == null else x)
	return t

## JS truthiness for primitives read out of JSON-like data (objects/arrays count as truthy)
static func truthy(v) -> bool:
	match typeof(v):
		TYPE_NIL:
			return false
		TYPE_BOOL:
			return v
		TYPE_INT:
			return v != 0
		TYPE_FLOAT:
			return v != 0.0 and not is_nan(v)
		TYPE_STRING, TYPE_STRING_NAME:
			return v != ""
	return true

## JS `a ?? b`
static func nz(a, b):
	return b if a == null else a
