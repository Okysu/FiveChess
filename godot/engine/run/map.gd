## Port of src/engine/run/map.ts — branching act map (7 columns x 15 rows, 6 paths), deterministic from a seed.
## MapNode {row, col, type, next: [col], x, y}; MapData {act, rows: [[MapNode]], boss, width, height}
class_name MqMap
extends RefCounted

const MAP_COLS := 7
const MAP_ROWS := 15

## o: {act, hasLieutenant, tutorial?, ascension}
static func generate_map(seed: String, o: Dictionary) -> Dictionary:
	var rng = MqRng.seed_rng(seed)
	if o.act == 4:
		return final_map()
	var grid = []
	for r in MAP_ROWS:
		var row = []
		row.resize(MAP_COLS)
		grid.append(row)
	var edges = {}
	var starts = []
	for p in 6:
		var c = MqRng.rand_int(rng, 0, MAP_COLS - 1)
		if p == 1:
			while starts.has(c) and starts.size() < MAP_COLS:
				c = MqRng.rand_int(rng, 0, MAP_COLS - 1)
		starts.append(c)
		for r in MAP_ROWS:
			var node = grid[r][c]
			if node == null:
				node = {"row": r, "col": c, "type": "combat", "next": [], "x": 0, "y": 0}
				grid[r][c] = node
			if r == MAP_ROWS - 1:
				break
			# choose next column, avoiding crossing edges
			var opts = []
			for x in [c - 1, c, c + 1]:
				if x >= 0 and x < MAP_COLS:
					opts.append(x)
			var nc = c
			for tries in 6:
				var cand: int = opts[MqRng.rand_int(rng, 0, opts.size() - 1)]
				var crossing: bool = cand != c and edges.has("%d:%d->%d" % [r, cand, c])
				if not crossing:
					nc = cand
					break
			edges["%d:%d->%d" % [r, c, nc]] = true
			if not node.next.has(nc):
				node.next.append(nc)
			c = nc
	var rows = []
	for row in grid:
		var kept = []
		for n in row:
			if n != null:
				kept.append(n)
		rows.append(kept)
	assign_types(rng, grid, o)
	# layout coordinates in [0,1]
	for row in rows:
		for n in row:
			n.x = MqU.fdiv(n.col + 0.5, MAP_COLS) + MqU.fdiv(MqRng.rand_int(rng, -20, 20), 1000)
			n.y = 1 - MqU.fdiv(n.row + 0.5, MAP_ROWS + 1)
			MqU.sort_in_place(n.next, func(a, b): return a - b)
	return {"act": o.act, "rows": rows, "boss": null, "width": MAP_COLS, "height": MAP_ROWS}

static func parents_of(grid: Array, n: Dictionary) -> Array:
	if n.row == 0:
		return []
	var out = []
	for p in MqU.nz(MqU.at(grid, n.row - 1), []):
		if p != null and p.next.has(n.col):
			out.append(p)
	return out

static func assign_types(rng: Array, grid: Array, o: Dictionary) -> void:
	var weights = [
		["combat", 45], ["event", 22], ["elite", 10 if o.ascension >= 1 else 8], ["camp", 12], ["shop", 5], ["stargaze", 4],
		["recruit", 5 if o.act >= 2 and not o.hasLieutenant else 0],
	]
	var restricted = ["elite", "camp", "shop", "recruit", "stargaze"]
	for r in MAP_ROWS:
		for n in grid[r]:
			if n == null:
				continue
			if r == 0:
				n.type = "combat"
				continue
			if r == 8:
				n.type = "chest"
				continue
			if r == MAP_ROWS - 1:
				n.type = "camp"
				continue
			if o.get("tutorial") == true and o.act == 1 and r <= 2:
				n.type = "event" if r == 1 else "combat"
				continue
			var parents = parents_of(grid, n)
			var siblings = []
			for p in parents:
				for c in p.next:
					if c != n.col:
						var sib = grid[r][c]
						if sib != null:
							siblings.append(sib)
			var pool = []
			for wt in weights:
				var t: String = wt[0]
				var w: int = wt[1]
				if w <= 0:
					continue
				if (t == "elite" or t == "camp") and r < 5:
					continue
				if t == "camp" and r == MAP_ROWS - 2:
					continue
				var bad = false
				if restricted.has(t):
					for p in parents:
						if p.type == t:
							bad = true
							break
				if bad:
					continue
				if t != "combat" and t != "event":
					for sb in siblings:
						if sb.type == t:
							bad = true
							break
				if bad:
					continue
				pool.append(wt)
			n.type = MqRng.weighted_pick(rng, pool, func(x): return x[1])[0]
	# guarantee recruit nodes in act 2 when no lieutenant yet
	if o.act == 2 and not o.hasLieutenant:
		var all = []
		for row in grid:
			for n in row:
				if n != null and n.row >= 2 and n.row <= 12 and n.row != 8:
					all.append(n)
		var have = 0
		for n in all:
			if n.type == "recruit":
				have += 1
		var cands = []
		for n in all:
			if n.type == "combat" or n.type == "event":
				cands.append(n)
		var k = have
		while k < 3 and not cands.is_empty():
			var i = MqRng.rand_int(rng, 0, cands.size() - 1)
			var picked = cands[i]
			cands.remove_at(i)
			picked.type = "recruit"
			k += 1

static func final_map() -> Dictionary:
	var mk = func(row: int, type: String, next: Array) -> Dictionary:
		return {"row": row, "col": 3, "type": type, "next": next, "x": 0.5, "y": 1 - MqU.fdiv(row + 0.5, 4)}
	return {"act": 4, "rows": [[mk.call(0, "camp", [3])], [mk.call(1, "shop", [3])], [mk.call(2, "boss", [])]], "boss": null, "width": MAP_COLS, "height": 3}

static func node_at(map: Dictionary, row: int, col: int):
	var r = MqU.at(map.rows, row)
	if r == null:
		return null
	for n in r:
		if n.col == col:
			return n
	return null

## nodes the player can move to next
static func reachable(map: Dictionary, pos) -> Array:
	if pos == null:
		return MqU.nz(MqU.at(map.rows, 0), [])
	var cur = node_at(map, pos.row, pos.col)
	if cur == null:
		return []
	var out = []
	for c in cur.next:
		var n = node_at(map, pos.row + 1, c)
		if n != null:
			out.append(n)
	return out
