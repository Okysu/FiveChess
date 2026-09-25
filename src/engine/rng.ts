/**
 * Deterministic, serializable PRNG (sfc32) with string-seed derivation.
 * State is a plain 4-tuple so it can live inside save data and survive structuredClone.
 */
export type RngState = [number, number, number, number];

/** cyrb128 string hash → 4 x 32-bit seeds */
function cyrb128(str: string): RngState {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4; h2 ^= h1; h3 ^= h1; h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export function seedRng(seed: string): RngState {
  const s = cyrb128(seed);
  // warm up
  const st: RngState = [...s];
  for (let i = 0; i < 12; i++) nextU32(st);
  return st;
}

/** Derive an independent child stream, e.g. deriveSeed(runSeed, 'combat:3') */
export function deriveSeed(parent: string, label: string): string {
  return `${parent}/${label}`;
}

export function nextU32(s: RngState): number {
  let [a, b, c, d] = s;
  a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
  const t = (((a + b) >>> 0) + d) >>> 0;
  d = (d + 1) >>> 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) >>> 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) >>> 0;
  s[0] = a >>> 0; s[1] = b >>> 0; s[2] = c >>> 0; s[3] = d;
  return t;
}

/** [0,1) */
export function rand(s: RngState): number {
  return nextU32(s) / 4294967296;
}

/** integer in [min, max] inclusive */
export function randInt(s: RngState, min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.floor(rand(s) * (max - min + 1));
}

export function pick<T>(s: RngState, arr: readonly T[]): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[Math.floor(rand(s) * arr.length)];
}

export function shuffle<T>(s: RngState, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

export function weightedPick<T>(s: RngState, items: readonly T[], weight: (t: T) => number): T | undefined {
  let total = 0;
  for (const it of items) total += Math.max(0, weight(it));
  if (total <= 0) return items[0];
  let r = rand(s) * total;
  for (const it of items) {
    r -= Math.max(0, weight(it));
    if (r < 0) return it;
  }
  return items[items.length - 1];
}

export function sample<T>(s: RngState, arr: readonly T[], n: number): T[] {
  return shuffle(s, [...arr]).slice(0, n);
}
