/** 兑换码: round trip, tamper / typo detection, expiry, once per profile, 命数 opening the unlock track. */
import { describe, expect, it } from 'vitest';
import { loadContent } from '../scripts/load-content';
import { decodeRedeem, encodeRedeem, expiryDay, redeem, REDEEM_TYPES } from '../src/engine/redeem';
import { newProfile } from '../src/engine/meta';

loadContent();
const XP = REDEEM_TYPES.find((t) => t.key === 'xp')!.id;

describe('兑换码', () => {
  it('decodes exactly what was encoded, for many values', () => {
    for (let i = 0; i < 300; i++) {
      const c = { type: XP, param: i % 256, amount: (i * 7919) % 2 ** 24, expiry: (i * 37) % 2 ** 16, serial: (i * 104729) % 2 ** 20 };
      const code = encodeRedeem(c);
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){4}$/);
      const d = decodeRedeem(code);
      expect(d.ok).toBe(true);
      if (d.ok) expect({ ...d.code }).toEqual({ version: 1, ...c });
    }
  });

  it('neighbouring serials look unrelated', () => {
    const a = encodeRedeem({ type: XP, param: 0, amount: 5000, expiry: 0, serial: 1 });
    const b = encodeRedeem({ type: XP, param: 0, amount: 5000, expiry: 0, serial: 2 });
    const same = [...a].filter((ch, i) => ch === b[i]).length;
    expect(same).toBeLessThan(14); // dashes + the fixed tail + chance
  });

  it('forgives case, spaces and look-alikes; rejects any changed character', () => {
    const code = encodeRedeem({ type: XP, param: 0, amount: 1234, expiry: 0, serial: 77 });
    expect(decodeRedeem(code.toLowerCase().replace(/-/g, ' ')).ok).toBe(true);
    for (let i = 0; i < 23; i++) {
      const raw = code.replace(/-/g, '');
      const ch = raw[i]!;
      const swapped = raw.slice(0, i) + (ch === 'A' ? 'B' : 'A') + raw.slice(i + 1);
      expect(decodeRedeem(swapped).ok, `position ${i}`).toBe(false);
    }
    expect(decodeRedeem('HELLO').ok).toBe(false);
  });

  it('grants 命数 once, opens unlocks, honours expiry', () => {
    const p = newProfile();
    const code = encodeRedeem({ type: XP, param: 0, amount: 5000, expiry: 0, serial: 9 });
    const r = redeem(p, code);
    expect(r.ok).toBe(true);
    expect(p.xp).toBe(5000);
    if (r.ok) expect(r.notices.some((n) => n.includes('柳絮'))).toBe(true); // crossed 4300
    expect(p.unlocked.commanders).toContain('p_liuxu');
    expect(redeem(p, code)).toMatchObject({ ok: false, error: 'used' });
    const old = encodeRedeem({ type: XP, param: 0, amount: 10, expiry: expiryDay(new Date('2026-03-01T00:00:00Z')), serial: 10 });
    expect(redeem(p, old, Date.parse('2026-03-01T23:00:00Z')).ok).toBe(true); // valid through that day
    const old2 = encodeRedeem({ type: XP, param: 0, amount: 10, expiry: expiryDay(new Date('2026-03-01T00:00:00Z')), serial: 11 });
    expect(redeem(p, old2, Date.parse('2026-03-02T00:00:01Z'))).toMatchObject({ ok: false, error: 'expired' });
  });

  it('a type this build does not know asks for an update', () => {
    const code = encodeRedeem({ type: 200, param: 0, amount: 1, expiry: 0, serial: 1 });
    expect(redeem(newProfile(), code)).toMatchObject({ ok: false, error: 'type' });
  });
});
