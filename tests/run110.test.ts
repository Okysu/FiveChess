/** 1.1 run layer: 命劫 nodes, 精英词缀 rolls and rewards, 命书残页, 首领认人 lines. */
import { describe, expect, it } from 'vitest';
import { loadContent } from '../scripts/load-content';
import { generateMap } from '../src/engine/run/map';
import { newRun, nodeAffixes, applyCombatResult, type RunState } from '../src/engine/run/run';
import { newProfile, recordRun, PAGES } from '../src/engine/meta';
import epilogues from '../src/data/lore/epilogues.json';

const c = loadContent();

describe('命劫 nodes', () => {
  it('every act 1–3 map has exactly one fated elite, away from the start', () => {
    for (let k = 0; k < 30; k++) for (const act of [1, 2, 3]) {
      const m = generateMap(`fated:${k}:${act}`, { act, hasLieutenant: false, ascension: 0 });
      const fated = m.rows.flat().filter((n) => n.fated);
      expect(fated.length).toBe(1);
      expect(fated[0]!.type).toBe('elite');
      expect(fated[0]!.row).toBeGreaterThanOrEqual(6);
    }
  });
  it('the tutorial act has none, and the final act has none', () => {
    expect(generateMap('t', { act: 1, hasLieutenant: false, ascension: 0, tutorial: true }).rows.flat().some((n) => n.fated)).toBe(false);
    expect(generateMap('t', { act: 4, hasLieutenant: false, ascension: 0 }).rows.flat().some((n) => n.fated)).toBe(false);
  });
});

function run(seed: string): RunState {
  return newRun({ seed, commander: 'r_huojin', ascension: 0 } as Parameters<typeof newRun>[0]);
}

describe('精英词缀', () => {
  it('none in act 1, one from act 2, two on a fated node — stable per node', () => {
    const r = run('affix');
    const elite = { row: 7, col: 2, type: 'elite' as const, next: [], x: 0, y: 0 };
    r.act = 1;
    expect(nodeAffixes(r, elite)).toEqual([]);
    expect(nodeAffixes(r, { ...elite, fated: true }).length).toBe(2);
    r.act = 2;
    const a = nodeAffixes(r, elite);
    expect(a.length).toBe(1);
    expect(nodeAffixes(r, elite)).toEqual(a);
    for (const id of nodeAffixes(r, { ...elite, fated: true })) expect(c.affixes.has(id)).toBe(true);
    expect(nodeAffixes(r, { ...elite, type: 'combat' })).toEqual([]);
  });
  it('an affixed elite pays 25 gold per affix; a fated one adds a boss relic', () => {
    const r = run('reward');
    r.screen = { k: 'combat', encounter: 'enc2_elite_iron_warden', tier: 'elite', seed: 'x', reward: 'elite', affixes: ['af_tough', 'af_leech'], fated: true };
    applyCombatResult(r, { t: 'combatResult', result: 'win', hp: r.hp, gold: 0, potions: r.potions, relics: r.relics, stats: { judgesThisTurn: {}, dead: 1, responses: 0, damageDealt: 10, damageTaken: 0, cardsPlayed: 3, turns: 3 }, enemies: [] });
    const sc = r.screen as RunState['screen'];
    expect(sc.k).toBe('reward');
    if (sc.k !== 'reward') return;
    const gold = sc.items.find((i) => i.k === 'gold');
    expect(gold && 'n' in gold ? gold.n : 0).toBeGreaterThanOrEqual(25 + 50);
    const relics = sc.items.filter((i) => i.k === 'relic').map((i) => ('id' in i ? i.id : ''));
    expect(relics.some((id) => c.relic(id).tier === 'boss')).toBe(true);
  });
  it('a thief that got away takes the difference out of your purse', () => {
    const r = run('thief');
    r.gold = 100;
    r.screen = { k: 'combat', encounter: 'enc1_elite_life_thief', tier: 'elite', seed: 'x', reward: 'elite' };
    applyCombatResult(r, { t: 'combatResult', result: 'win', hp: r.hp, gold: -200, potions: r.potions, relics: r.relics, stats: { judgesThisTurn: {}, dead: 0, responses: 0, damageDealt: 0, damageTaken: 0, cardsPlayed: 0, turns: 5 }, enemies: [] });
    expect(r.gold).toBeLessThan(100);
    expect(r.gold).toBeGreaterThanOrEqual(0);
  });
  it('a relic sealed in the fight is never sealed afterwards', () => {
    const r = run('seal');
    r.screen = { k: 'combat', encounter: 'enc3_elite_faceless_scribe', tier: 'elite', seed: 'x', reward: 'elite' };
    applyCombatResult(r, { t: 'combatResult', result: 'win', hp: r.hp, gold: 0, potions: r.potions, relics: r.relics.map((x) => ({ ...x, disabled: true })), stats: { judgesThisTurn: {}, dead: 1, responses: 0, damageDealt: 0, damageTaken: 0, cardsPlayed: 0, turns: 5 }, enemies: [] });
    expect(r.relics.every((x) => !x.disabled)).toBe(true);
  });
});

describe('命书残页', () => {
  it('every boss has exactly one page, and every page names a real boss', () => {
    const bosses = [...c.enemies.values()].filter((e) => e.tier === 'boss' && !e.variantOf).map((e) => e.id).sort();
    expect(PAGES.map((p) => p.boss).sort()).toEqual(bosses);
    expect(new Set(PAGES.map((p) => p.id)).size).toBe(PAGES.length);
  });
  it('a boss beaten in a run leaves its page in the profile, once', () => {
    const r = run('pages');
    r.screen = { k: 'combat', encounter: 'enc2_boss_lost_seeker', tier: 'boss', seed: 'x', reward: 'boss' };
    applyCombatResult(r, { t: 'combatResult', result: 'win', hp: r.hp, gold: 0, potions: r.potions, relics: r.relics, stats: { judgesThisTurn: {}, dead: 1, responses: 0, damageDealt: 0, damageTaken: 0, cardsPlayed: 0, turns: 5 }, enemies: [] });
    expect(r.flags).toContain('beat:e2_boss_lost_seeker');
    const p = newProfile();
    const summary = { seed: 'x', commander: 'r_huojin', lieutenant: null, ascension: 0, result: 'lose' as const, act: 2, floor: 20, score: 100, date: 0, deck: [], relics: [], turns: 50, maxDamage: 10 };
    const notes = recordRun(p, r, summary);
    expect(p.pages).toEqual(['pg_lost_seeker']);
    expect(notes.some((n) => n.includes('前人'))).toBe(true);
    recordRun(p, r, summary);
    expect(p.pages).toEqual(['pg_lost_seeker']);
  });
});

describe('首领认人', () => {
  it('every greeting names a real boss and, if any, a real commander', () => {
    for (const b of (epilogues as { bossIntro: { enemy: string; commander?: string }[] }).bossIntro) {
      expect(c.enemies.has(b.enemy), b.enemy).toBe(true);
      if (b.commander) expect(c.commanders.has(b.commander), b.commander).toBe(true);
    }
  });
});
