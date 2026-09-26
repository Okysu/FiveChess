## Port of src/engine/rng.ts — deterministic, serializable PRNG (sfc32) with cyrb128 string-seed derivation.
## State is a plain 4-element Array of uint32 values (same as the TS RngState tuple).
##
## GDScript ints are 64-bit signed: every 32-bit op is masked with & M32; JS `>>>` on a uint32 is a plain
## right shift of the masked value; Math.imul is emulated with a split 16-bit multiply (no 64-bit overflow).
## All values are kept as unsigned 32-bit patterns — XOR/imul/shift results are bit-identical to the JS int32
## ops because the TS code normalises with `>>> 0` before storing or dividing.
class_name MqRng
extends RefCounted

const M32 := 0xFFFFFFFF

## Math.imul(a, b) as an unsigned 32-bit pattern
static func imul(a: int, b: int) -> int:
	a &= M32
	b &= M32
	var ah = (a >> 16) & 0xFFFF
	var al = a & 0xFFFF
	# (ah*2^16 + al) * b mod 2^32 == ((ah*b mod 2^16) << 16) + al*b  (mod 2^32)
	return ((((ah * b) & 0xFFFF) << 16) + al * b) & M32

## UTF-16 code units of a string (String.charCodeAt semantics)
static func utf16_units(str: String) -> PackedInt32Array:
	var out = PackedInt32Array()
	for i in str.length():
		var cp = str.unicode_at(i)
		if cp > 0xFFFF:
			cp -= 0x10000
			out.append(0xD800 + (cp >> 10))
			out.append(0xDC00 + (cp & 0x3FF))
		else:
			out.append(cp)
	return out

## cyrb128 string hash -> 4 x 32-bit seeds
static func cyrb128(str: String) -> Array:
	var h1 = 1779033703
	var h2 = 3144134277
	var h3 = 1013904242
	var h4 = 2773480762
	for k in utf16_units(str):
		h1 = h2 ^ imul(h1 ^ k, 597399067)
		h2 = h3 ^ imul(h2 ^ k, 2869860233)
		h3 = h4 ^ imul(h3 ^ k, 951274213)
		h4 = h1 ^ imul(h4 ^ k, 2716044179)
	h1 = imul(h3 ^ (h1 >> 18), 597399067)
	h2 = imul(h4 ^ (h2 >> 22), 2869860233)
	h3 = imul(h1 ^ (h3 >> 17), 951274213)
	h4 = imul(h2 ^ (h4 >> 19), 2716044179)
	h1 ^= h2 ^ h3 ^ h4
	h2 ^= h1
	h3 ^= h1
	h4 ^= h1
	return [h1 & M32, h2 & M32, h3 & M32, h4 & M32]

static func seed_rng(seed: String) -> Array:
	var st = cyrb128(seed)
	for i in 12:
		next_u32(st)
	return st

## derive an independent child stream label, e.g. derive_seed(runSeed, "combat:3")
static func derive_seed(parent: String, label: String) -> String:
	return parent + "/" + label

static func next_u32(s: Array) -> int:
	var a: int = s[0] & M32
	var b: int = s[1] & M32
	var c: int = s[2] & M32
	var d: int = s[3] & M32
	var t = (((a + b) & M32) + d) & M32
	d = (d + 1) & M32
	a = b ^ (b >> 9)
	b = (c + ((c << 3) & M32)) & M32
	var c2 = ((c << 21) & M32) | (c >> 11)
	c2 = (c2 + t) & M32
	s[0] = a & M32
	s[1] = b
	s[2] = c2
	s[3] = d
	return t

## [0,1)
static func rand(s: Array) -> float:
	return float(next_u32(s)) / 4294967296.0

## integer in [min, max] inclusive
static func rand_int(s: Array, mn: int, mx: int) -> int:
	if mx <= mn:
		return mn
	return mn + int(floor(rand(s) * float(mx - mn + 1)))

static func pick(s: Array, arr: Array):
	if arr.is_empty():
		return null
	return arr[int(floor(rand(s) * float(arr.size())))]

static func shuffle(s: Array, arr: Array) -> Array:
	var i = arr.size() - 1
	while i > 0:
		var j = int(floor(rand(s) * float(i + 1)))
		var tmp = arr[i]
		arr[i] = arr[j]
		arr[j] = tmp
		i -= 1
	return arr

static func weighted_pick(s: Array, items: Array, weight: Callable):
	var total = 0.0
	for it in items:
		total += max(0.0, float(weight.call(it)))
	if total <= 0.0:
		return MqU.at(items, 0)
	var r = rand(s) * total
	for it in items:
		r -= max(0.0, float(weight.call(it)))
		if r < 0.0:
			return it
	return MqU.at(items, items.size() - 1)

static func sample(s: Array, arr: Array, n) -> Array:
	return MqU.js_slice(shuffle(s, arr.duplicate()), 0, n)
