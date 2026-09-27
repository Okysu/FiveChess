/**
 * 兑换码 (redeem codes): offline, computed codes — the official "cheat" for trying new content quickly.
 * A code decodes to { type, param, amount, expiry, serial } and carries a 32-bit check, so typos and edited codes
 * fail. The check key has to ship with the game (there is no server), so this keeps honest players honest; it is
 * not tamper-proof and never needs to be for a single-player unlock.
 *
 * Layout (112 bits → 23 Crockford base32 chars, shown as 5 groups of 5 with 2 check-free padding chars):
 *   version 4 · type 8 · param 8 · amount 24 · expiry 16 (days since 2026-01-01, 0 = never) · serial 20 · check 32
 * The 80 payload bits are masked with a stream derived from the check, so codes don't show their structure.
 *
 * Types live in REDEEM_TYPES: add an entry (new id, name, apply) to support another reward later.
 */
import { applyUnlockTrack, type Profile } from './meta';

const VERSION = 1;
const KEY = 'mingque/redeem/v1:枯木逢春·命书续章';
const EPOCH = Date.UTC(2026, 0, 1);
const DAY = 86_400_000;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford: no I L O U

export interface RedeemType {
  id: number;
  key: string;
  name: string;
  /** what the amount means, for the confirmation line */
  describe(amount: number, param: number): string;
  /** grant it; returns notices (unlocks …) */
  apply(p: Profile, amount: number, param: number): string[];
}

export const REDEEM_TYPES: RedeemType[] = [
  {
    id: 1, key: 'xp', name: '命数',
    describe: (n) => `命数 +${n}`,
    apply: (p, n) => { const before = p.xp; p.xp += n; return applyUnlockTrack(p, before); },
  },
  // future rewards: give each a new id (2, 3 …) — e.g. 精通 for the commander in `param`, a 命签 pack, a cosmetic
];

export interface RedeemCode { version: number; type: number; param: number; amount: number; expiry: number; serial: number }
export type DecodeResult = { ok: true; code: RedeemCode; typeDef: RedeemType | undefined } | { ok: false; error: 'format' | 'check' | 'version' };

// ───────────── hashing (sync, deterministic; a keyed 32-bit check and a mask stream) ─────────────

function hash32(bytes: number[], seed: number): number {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  const all = [...Array.from(new TextEncoder().encode(KEY)), ...bytes];
  for (const b of all) { h1 = Math.imul(h1 ^ b, 2654435761); h2 = Math.imul(h2 ^ b, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

function maskBytes(check: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; out.length < n; i++) { const w = hash32([check & 255, (check >>> 8) & 255, (check >>> 16) & 255, check >>> 24, i], 0x9e3779b9); out.push(w & 255, (w >>> 8) & 255, (w >>> 16) & 255, w >>> 24); }
  return out.slice(0, n);
}

// ───────────── bits ─────────────

function packPayload(c: RedeemCode): number[] {
  let bits = '';
  const put = (v: number, n: number) => { bits += (v >>> 0).toString(2).padStart(n, '0').slice(-n); };
  put(c.version, 4); put(c.type, 8); put(c.param, 8); put(c.amount, 24); put(c.expiry, 16); put(c.serial, 20);
  return Array.from({ length: 10 }, (_, i) => parseInt(bits.slice(i * 8, i * 8 + 8), 2));
}

function unpackPayload(bytes: number[]): RedeemCode {
  const bits = bytes.map((b) => b.toString(2).padStart(8, '0')).join('');
  let at = 0;
  const get = (n: number) => { const v = parseInt(bits.slice(at, at + n), 2); at += n; return v; };
  return { version: get(4), type: get(8), param: get(8), amount: get(24), expiry: get(16), serial: get(20) };
}

function toBase32(bytes: number[]): string {
  const bits = bytes.map((b) => b.toString(2).padStart(8, '0')).join('').padEnd(115, '0');
  let s = '';
  for (let i = 0; i < 115; i += 5) s += ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  return s;
}

function fromBase32(s: string): number[] | null {
  let bits = '';
  for (const ch of s) { const v = ALPHABET.indexOf(ch); if (v < 0) return null; bits += v.toString(2).padStart(5, '0'); }
  if (bits.length < 112) return null;
  return Array.from({ length: 14 }, (_, i) => parseInt(bits.slice(i * 8, i * 8 + 8), 2));
}

/** what a player types: case, spaces, dashes and the look-alikes Crockford maps (O→0, I/L→1) are forgiven */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[\s\-_]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

// ───────────── public ─────────────

export function encodeRedeem(c: Omit<RedeemCode, 'version'>): string {
  const code: RedeemCode = { version: VERSION, ...c };
  if (code.amount < 0 || code.amount >= 2 ** 24) throw new Error('amount out of range (0 … 16777215)');
  if (code.expiry < 0 || code.expiry >= 2 ** 16) throw new Error('expiry out of range');
  if (code.serial < 0 || code.serial >= 2 ** 20) throw new Error('serial out of range (0 … 1048575)');
  const payload = packPayload(code);
  const check = hash32(payload, 0x5bd1e995);
  const mask = maskBytes(check, payload.length);
  const bytes = [...payload.map((b, i) => b ^ mask[i]!), check >>> 24, (check >>> 16) & 255, (check >>> 8) & 255, check & 255];
  const body = toBase32(bytes).slice(0, 23) + 'MQ'; // 23 data chars + a fixed tail → 5 × 5
  return body.match(/.{5}/g)!.join('-');
}

export function decodeRedeem(input: string): DecodeResult {
  const s = normalizeCode(input);
  if (s.length !== 25 || !s.endsWith('MQ')) return { ok: false, error: 'format' };
  const bytes = fromBase32(s.slice(0, 23));
  if (!bytes) return { ok: false, error: 'format' };
  const check = ((bytes[10]! << 24) | (bytes[11]! << 16) | (bytes[12]! << 8) | bytes[13]!) >>> 0;
  const mask = maskBytes(check, 10);
  const payload = bytes.slice(0, 10).map((b, i) => b ^ mask[i]!);
  if (hash32(payload, 0x5bd1e995) !== check) return { ok: false, error: 'check' };
  const code = unpackPayload(payload);
  if (code.version !== VERSION) return { ok: false, error: 'version' };
  return { ok: true, code, typeDef: REDEEM_TYPES.find((t) => t.id === code.type) };
}

/** days since 2026-01-01 ↔ dates; expiry 0 = never expires, otherwise valid through the end of that day (UTC) */
export function expiryDay(date: Date): number { return Math.floor((date.getTime() - EPOCH) / DAY); }
export function expiryDate(day: number): Date { return new Date(EPOCH + day * DAY); }
export function isExpired(c: RedeemCode, now = Date.now()): boolean { return c.expiry > 0 && now >= EPOCH + (c.expiry + 1) * DAY; }

/** a code is used once per profile (by type + serial, so the same batch can't be re-entered) */
export const redeemKey = (c: RedeemCode) => `${c.type}:${c.param}:${c.serial}`;

export type RedeemOutcome =
  | { ok: true; code: RedeemCode; typeDef: RedeemType; notices: string[] }
  | { ok: false; error: 'format' | 'check' | 'version' | 'type' | 'expired' | 'used'; code?: RedeemCode };

export function redeem(p: Profile, input: string, now = Date.now()): RedeemOutcome {
  const d = decodeRedeem(input);
  if (!d.ok) return { ok: false, error: d.error };
  if (!d.typeDef) return { ok: false, error: 'type', code: d.code };
  if (isExpired(d.code, now)) return { ok: false, error: 'expired', code: d.code };
  p.redeemed ??= [];
  const key = redeemKey(d.code);
  if (p.redeemed.includes(key)) return { ok: false, error: 'used', code: d.code };
  p.redeemed.push(key);
  const notices = d.typeDef.apply(p, d.code.amount, d.code.param);
  return { ok: true, code: d.code, typeDef: d.typeDef, notices };
}
