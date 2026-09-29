/**
 * Every player-facing text must render without raw placeholders: card texts once their vars are filled,
 * and all other content (relics, potions, skills, enemies, events) which has no vars at all.
 * Allowed tokens are the ones the rich-text renderer draws as icons: {R}{B}{G}{Y}{P}{N}, {sun}{thunder}{moon}{mountain}, {X}.
 */
import { describe, expect, it } from 'vitest';
import { loadContent } from '../scripts/load-content';
import { content } from '../src/engine/content';
import { fillVars, plainRules } from '../src/engine/glossary';

loadContent();
const c = content();
const ICON = new Set(['R', 'B', 'G', 'Y', 'P', 'K', 'W', 'N', 'sun', 'thunder', 'moon', 'mountain', 'X', 'x']);
const leftovers = (t: string) => [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).filter((k) => !ICON.has(k));

describe('fillVars', () => {
  it('fills known vars, keeps icon tokens and unknown keys', () => {
    expect(fillVars('得{a}点{sun}', { a: 2 })).toBe('得2点{sun}');
    expect(fillVars('{a}+{b}', { a: 1 })).toBe('1+{b}');
    expect(plainRules('[护甲]{a}{sun}', { a: 3 })).toBe('护甲3');
  });
});

describe('no raw {var} in any displayed text', () => {
  it('cards (base and upgraded) after filling their vars', () => {
    const bad: string[] = [];
    for (const id of c.cards.keys()) for (const up of [false, true]) {
      const d = c.card(id, up);
      const left = leftovers(fillVars(d.text, d.vars));
      if (left.length) bad.push(`${id}${up ? '+' : ''}: {${left.join('},{')}}`);
    }
    expect(bad).toEqual([]);
  });
  it('relics, potions, skills, enemies, events (no vars there)', () => {
    const bad: string[] = [];
    const chk = (where: string, t?: string) => { if (t && leftovers(t).length) bad.push(`${where}: ${t.slice(0, 40)}`); };
    for (const r of c.relics.values()) chk(r.id, r.text);
    for (const p of c.potions.values()) chk(p.id, p.text);
    for (const cm of c.commanders.values()) for (const s of cm.skills) chk(`${cm.id}/${s.id}`, s.text);
    for (const lt of c.lieutenants.values()) chk(lt.id, lt.skill.text);
    for (const e of c.enemies.values()) { chk(e.id, e.lore); for (const ph of e.phases ?? []) chk(`${e.id}/${ph.name}`, ph.text); }
    for (const ev of c.events.values()) {
      chk(ev.id, ev.text);
      for (const o of [...ev.options, ...(ev.pages ?? []).flatMap((p) => p.options)]) { chk(`${ev.id}/opt`, o.text); chk(`${ev.id}/hint`, o.hint); chk(`${ev.id}/out`, o.outcome); }
    }
    expect(bad).toEqual([]);
  });
});
