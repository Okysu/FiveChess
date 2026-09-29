/** Branching act map (7 columns × 15 rows, 6 paths), deterministic from a seed. */
import { randInt, seedRng, weightedPick, type RngState } from '../rng';

export type NodeType = 'combat' | 'elite' | 'event' | 'shop' | 'camp' | 'chest' | 'recruit' | 'stargaze' | 'boss';

export interface MapNode { row: number; col: number; type: NodeType; next: number[]; x: number; y: number; /** 命劫: an optional elite with two affixes and a boss relic */ fated?: boolean }
export interface MapData { act: number; rows: MapNode[][]; boss: string | null; width: number; height: number }

export const MAP_COLS = 7;
export const MAP_ROWS = 15;

interface GenOpts { act: number; hasLieutenant: boolean; tutorial?: boolean; ascension: number }

export function generateMap(seed: string, o: GenOpts): MapData {
  const rng = seedRng(seed);
  if (o.act === 4) return finalMap();
  const grid: (MapNode | null)[][] = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(null));
  const edges = new Set<string>();
  const ensure = (r: number, c: number) => {
    let n = grid[r]![c];
    if (!n) { n = { row: r, col: c, type: 'combat', next: [], x: 0, y: 0 }; grid[r]![c] = n; }
    return n;
  };
  const starts: number[] = [];
  for (let p = 0; p < 6; p++) {
    let c = randInt(rng, 0, MAP_COLS - 1);
    if (p === 1) while (starts.includes(c) && starts.length < MAP_COLS) c = randInt(rng, 0, MAP_COLS - 1);
    starts.push(c);
    for (let r = 0; r < MAP_ROWS; r++) {
      const node = ensure(r, c);
      if (r === MAP_ROWS - 1) break;
      // choose next column, avoiding crossing edges
      const opts = [c - 1, c, c + 1].filter((x) => x >= 0 && x < MAP_COLS);
      let nc = c;
      for (let tries = 0; tries < 6; tries++) {
        const cand = opts[randInt(rng, 0, opts.length - 1)]!;
        const crossing = cand !== c && edges.has(`${r}:${cand}->${c}`);
        if (!crossing) { nc = cand; break; }
      }
      edges.add(`${r}:${c}->${nc}`);
      if (!node.next.includes(nc)) node.next.push(nc);
      c = nc;
    }
  }
  const rows = grid.map((row) => row.filter((n): n is MapNode => !!n));
  assignTypes(rng, grid, o);
  // layout coordinates in [0,1]
  for (const row of rows) for (const n of row) {
    n.x = (n.col + 0.5) / MAP_COLS + (randInt(rng, -20, 20) / 1000);
    n.y = 1 - (n.row + 0.5) / (MAP_ROWS + 1);
    n.next.sort((a, b) => a - b);
  }
  if (!(o.tutorial && o.act === 1)) markFated(seedRng(`${seed}:fated`), rows);
  return { act: o.act, rows, boss: null, width: MAP_COLS, height: MAP_ROWS };
}

/** 命劫: one elite per act (rows 6+) becomes the fated one; its own rng keeps every other roll of the map unchanged */
function markFated(rng: RngState, rows: MapNode[][]) {
  const nodes = rows.flat().filter((n) => n.row >= 6 && n.row !== 8 && n.row < MAP_ROWS - 1);
  let cands = nodes.filter((n) => n.type === 'elite');
  if (!cands.length) {
    const combat = nodes.filter((n) => n.type === 'combat');
    if (!combat.length) return;
    const n = combat[randInt(rng, 0, combat.length - 1)]!;
    n.type = 'elite';
    cands = [n];
  }
  cands[randInt(rng, 0, cands.length - 1)]!.fated = true;
}

function parentsOf(grid: (MapNode | null)[][], n: MapNode): MapNode[] {
  if (n.row === 0) return [];
  return (grid[n.row - 1] ?? []).filter((p): p is MapNode => !!p && p.next.includes(n.col));
}

function assignTypes(rng: RngState, grid: (MapNode | null)[][], o: GenOpts) {
  const weights: [NodeType, number][] = [
    ['combat', 45], ['event', 22], ['elite', o.ascension >= 1 ? 10 : 8], ['camp', 12], ['shop', 5], ['stargaze', 4],
    ['recruit', o.act >= 2 && !o.hasLieutenant ? 5 : 0],
  ];
  const restricted: NodeType[] = ['elite', 'camp', 'shop', 'recruit', 'stargaze'];
  for (let r = 0; r < MAP_ROWS; r++) {
    for (const n of grid[r]!) {
      if (!n) continue;
      if (r === 0) { n.type = 'combat'; continue; }
      if (r === 8) { n.type = 'chest'; continue; }
      if (r === MAP_ROWS - 1) { n.type = 'camp'; continue; }
      if (o.tutorial && o.act === 1 && r <= 2) { n.type = r === 1 ? 'event' : 'combat'; continue; }
      const parents = parentsOf(grid, n);
      const siblings = parents.flatMap((p) => p.next.filter((c) => c !== n.col).map((c) => grid[r]![c]!).filter(Boolean));
      const pool = weights.filter(([t, w]) => {
        if (w <= 0) return false;
        if ((t === 'elite' || t === 'camp') && r < 5) return false;
        if (t === 'camp' && r === MAP_ROWS - 2) return false;
        if (restricted.includes(t) && parents.some((p) => p.type === t)) return false;
        if (t !== 'combat' && t !== 'event' && siblings.some((s) => s.type === t)) return false;
        return true;
      });
      n.type = weightedPick(rng, pool, (x) => x[1])![0];
    }
  }
  // guarantee recruit nodes in act 2 when no lieutenant yet
  if (o.act === 2 && !o.hasLieutenant) {
    const all = grid.flat().filter((n): n is MapNode => !!n && n.row >= 2 && n.row <= 12 && n.row !== 8);
    const have = all.filter((n) => n.type === 'recruit').length;
    const cands = all.filter((n) => n.type === 'combat' || n.type === 'event');
    for (let k = have; k < 3 && cands.length; k++) {
      const i = randInt(rng, 0, cands.length - 1);
      cands.splice(i, 1)[0]!.type = 'recruit';
    }
  }
}

function finalMap(): MapData {
  const mk = (row: number, type: NodeType, next: number[]): MapNode => ({ row, col: 3, type, next, x: 0.5, y: 1 - (row + 0.5) / 4 });
  return { act: 4, rows: [[mk(0, 'camp', [3])], [mk(1, 'shop', [3])], [mk(2, 'boss', [])]], boss: null, width: MAP_COLS, height: 3 };
}

export function nodeAt(map: MapData, row: number, col: number): MapNode | undefined {
  return map.rows[row]?.find((n) => n.col === col);
}

/** nodes the player can move to next */
export function reachable(map: MapData, pos: { row: number; col: number } | null): MapNode[] {
  if (!pos) return map.rows[0] ?? [];
  const cur = nodeAt(map, pos.row, pos.col);
  if (!cur) return [];
  return cur.next.map((c) => nodeAt(map, pos.row + 1, c)).filter((n): n is MapNode => !!n);
}
