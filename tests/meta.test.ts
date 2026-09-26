/** 1.0.1 meta: 开局祈命, 精通 (levels, loadout, 「另一面」), save v1 → v2 migration. */
import { describe, expect, it } from 'vitest';
import { loadContent } from '../scripts/load-content';
import { newRun, runAct, combatConfig, availableNodes } from '../src/engine/run/run';
import { createCombat } from '../src/engine/combat/api';
import { skillDef } from '../src/engine/combat/skills';
import {
  MASTERY_XP, blessingCount, blessingPool, effectiveLoadout, masteryLevel, masteryReward, migrateProfileV1, newProfile, UNLOCK_TRACK,
} from '../src/engine/meta';

const c = loadContent();

describe('开局祈命', () => {
  it('every 命签 is valid and every commander has a 精通 alternative', () => {
    expect(c.blessings.size).toBe(15);
    for (const b of c.blessings.values()) expect(b.effects.length).toBeGreaterThan(0);
    for (const cmd of c.commanders.values()) {
      expect(cmd.alt, cmd.id).toBeDefined();
      expect(c.relics.get(cmd.alt!.relic)?.tier).toBe('starter');
      expect(cmd.skills.some((s) => s.id === cmd.alt!.replaces), cmd.id).toBe(true);
    }
  });

  it('the pool grows with the 命数 track: 6 → 15', () => {
    const p = newProfile();
    expect(blessingPool(p)).toHaveLength(6);
    p.unlocked.blessingPacks = 3;
    expect(blessingPool(p)).toHaveLength(15);
  });

  it('3 choices, 2 from 逆命 10, +1 at 精通 8', () => {
    const p = newProfile();
    expect(blessingCount(p, 'r_huojin', 0)).toBe(3);
    expect(blessingCount(p, 'r_huojin', 10)).toBe(2);
    p.mastery.r_huojin = MASTERY_XP[7]!;
    expect(blessingCount(p, 'r_huojin', 0)).toBe(4);
    expect(blessingCount(p, 'b_shiyun', 0)).toBe(3);
  });

  it('a run starts on the 祈命 screen; taking one applies it, skipping goes straight to the map', () => {
    const pool = blessingPool(newProfile());
    const r = newRun({ seed: 'bless', commander: 'r_huojin', ascension: 0, blessings: { pool, count: 3 } });
    expect(r.screen.k).toBe('blessing');
    const opts = (r.screen as { options: string[] }).options;
    expect(new Set(opts).size).toBe(3);
    r.screen = { k: 'blessing', options: ['bl_windfall'] };
    const gold = r.gold, maxHp = r.maxHp;
    expect(runAct(r, { t: 'blessing', i: 0 })).toBeNull();
    expect(r.gold).toBe(gold + 120);
    expect(r.maxHp).toBe(maxHp - 5);
    expect(r.blessing).toBe('bl_windfall');
    expect(r.screen.k).toBe('actStart');

    const r2 = newRun({ seed: 'bless', commander: 'r_huojin', ascension: 0, blessings: { pool, count: 3 } });
    expect(runAct(r2, { t: 'blessing', i: null })).toBeNull();
    expect(r2.blessing).toBeNull();
    expect(r2.screen.k).toBe('actStart');
  });

  it('tutorial runs and runs without a pool skip it', () => {
    expect(newRun({ seed: 't', commander: 'r_huojin', ascension: 0, tutorial: true, blessings: { pool: ['bl_minor'], count: 3 } }).screen.k).toBe('actStart');
    expect(newRun({ seed: 't', commander: 'r_huojin', ascension: 0 }).screen.k).toBe('actStart');
  });

  it('多源 adds a start source of the commander\'s own colour', () => {
    const r = newRun({ seed: 'src', commander: 'b_shiyun', ascension: 0, blessings: { pool: ['bl_wellspring'], count: 1 } });
    runAct(r, { t: 'blessing', i: 0 });
    expect(r.extraStartSources).toEqual(['B']);
  });
});

describe('精通', () => {
  it('levels follow the thresholds', () => {
    expect(masteryLevel(0)).toBe(1);
    expect(masteryLevel(MASTERY_XP[2]! - 1)).toBe(2);
    expect(masteryLevel(MASTERY_XP[2]!)).toBe(3);
    expect(masteryLevel(99999)).toBe(MASTERY_XP.length);
    expect(masteryReward('r_huojin', 3)).toContain('焚阳火种');
    expect(masteryReward('r_huojin', 5)).toContain('燎原');
  });

  it('the loadout is only honoured once the level allows it', () => {
    const p = newProfile();
    p.loadout.r_huojin = { altRelic: true, altSkill: true };
    expect(effectiveLoadout(p, 'r_huojin')).toEqual({ altRelic: false, altSkill: false });
    p.mastery.r_huojin = MASTERY_XP[2]!;
    expect(effectiveLoadout(p, 'r_huojin')).toEqual({ altRelic: true, altSkill: false });
    p.mastery.r_huojin = MASTERY_XP[4]!;
    expect(effectiveLoadout(p, 'r_huojin')).toEqual({ altRelic: true, altSkill: true });
  });

  it('the second starter relic and 「另一面」 reach the combat', () => {
    const r = newRun({ seed: 'alt', commander: 'r_huojin', ascension: 0, altRelic: true, altSkill: true });
    expect(r.relics.map((x) => x.id)).toEqual(['rl_start_huojin_b']);
    runAct(r, { t: 'proceed' });
    const n = availableNodes(r).find((x) => x.type === 'combat')!;
    runAct(r, { t: 'go', row: n.row, col: n.col });
    const s = createCombat(combatConfig(r));
    const names = s.skills.map((sk) => skillDef(s, sk)?.name);
    expect(names).toContain('燎原');
    expect(names).not.toContain('焰随刀走');
    expect(s.sides.player.equip.weapon).toBeFalsy(); // 焚阳火种 has no blade
  });
});

describe('存档 v1 → v2', () => {
  it('backfills 精通 from history / run counts and 命签 packs from 命数', () => {
    const v1 = {
      v: 1, xp: 7200, runs: 9, wins: 1, tutorialDone: true,
      unlocked: { commanders: ['r_huojin', 'b_shiyun'], lieutenants: ['*'], cardPacks: 4, relicPacks: 2, eventPacks: 2 },
      ascension: {}, commanderStats: { r_huojin: { runs: 6, wins: 1, bestFloor: 40, highestAsc: 0 }, b_shiyun: { runs: 3, wins: 0, bestFloor: 20, highestAsc: 0 } },
      discovered: { cards: [], enemies: [], relics: [] }, hiddenUnlocked: true,
      history: [{ commander: 'r_huojin', score: 900 }, { commander: 'r_huojin', score: 800 }, { commander: 'b_shiyun', score: 300 }],
    };
    const p = migrateProfileV1(v1);
    expect(p.v).toBe(2);
    expect(p.mastery.r_huojin).toBe(1700); // history beats 6 × 250
    expect(p.mastery.b_shiyun).toBe(750); // 3 × 250 beats a 300 history
    expect(p.unlocked.blessingPacks).toBe(UNLOCK_TRACK.filter((t) => t.blessingPack && t.xp <= 7200).length);
    expect(p.unlocked.cardPacks).toBe(4);
    expect(p.loadout).toEqual({});
  });
});
