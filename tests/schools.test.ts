/** 1.1: 翰墨书院 (题字 / 拓印 / 墨迹·落款), 傩面班 (面具 / 揭面), the unlock catch-up and the 真结局 flow. */
import { describe, expect, it } from 'vitest';
import { loadContent } from '../scripts/load-content';
import { act, createCombat } from '../src/engine/combat/api';
import { autoAnswer } from '../src/engine/combat/autoplay';
import { commanderOf } from '../src/engine/combat/board';
import { effectiveCost, pushFx, run } from '../src/engine/combat/core';
import type { AnyEffect, CombatState, PlayerAction } from '../src/engine/combat/state';
import { SUITS } from '../src/engine/defs';
import { catchUpUnlocks, newProfile, trueEndingReady, PAGES } from '../src/engine/meta';
import { newRun, runAct, type RunState } from '../src/engine/run/run';

const c = loadContent();
const fate = SUITS.flatMap((suit) => Array.from({ length: 13 }, (_, i) => ({ suit, rank: i + 1 })));

function fight(commander: string, relics: string[] = []): CombatState {
  const cmd = c.commander(commander);
  return createCombat({
    commander, hp: 300, maxHp: 300, deck: cmd.deck.map((id) => ({ id, up: false })), relics: [cmd.relic, ...relics].map((id) => ({ id, counter: 0 })),
    potions: [], fateDeck: fate, encounter: 'enc1_boss_blank_stele', ascension: 0, seed: `schools:${commander}`,
  });
}
function answer(s: CombatState, pick?: (s: CombatState) => PlayerAction | null) {
  for (let i = 0; i < 20 && s.pending && !s.over; i++) act(s, pick?.(s) ?? autoAnswer(s));
}
function asPlayer(s: CombatState, effects: AnyEffect[]) {
  pushFx(s, effects, { side: 'player', source: s.sides.player.commander, kind: 'system', target: null, vars: {} });
  run(s);
}
const pc = (s: CombatState) => commanderOf(s, 'player')!;
const boss = (s: CombatState) => commanderOf(s, 'enemy')!;

describe('翰墨书院', () => {
  it('题字: the chosen card costs 1 less for the rest of the combat, and stays inscribed in the discard pile', () => {
    const s = fight('k_yanqiu');
    const target = s.hand.find((x) => c.card(x.id).cost.g === 1)!;
    const before = effectiveCost(s, target).g;
    asPlayer(s, [{ op: 'inscribe', n: 1, mode: 'choose' }]);
    expect(s.pending?.kind).toBe('chooseCards');
    act(s, { type: 'choose', picks: [target.uid] });
    expect(target.inked).toBe(1);
    expect(effectiveCost(s, target).g).toBe(before - 1);
  });
  it('砚秋 润笔: playing an inscribed card gives 墨迹', () => {
    const s = fight('k_yanqiu');
    const card = { uid: 90001, id: 'k_grind', up: false, inked: 1 };
    s.hand.push(card);
    s.sources.push({ color: 'K', ready: true });
    delete pc(s).statuses.ink; // start from 0 so 墨满则溢 (8) does not fire
    const ink0 = 0;
    expect(act(s, { type: 'play', card: card.uid, target: null }).ok).toBe(true);
    answer(s);
    // 研磨 4 + 润笔 2
    expect(pc(s).statuses.ink ?? 0).toBe(ink0 + 4 + 2);
  });
  it('拓印: a fleeting copy of a discard-pile card joins the hand', () => {
    const s = fight('k_shentuo');
    s.discard.push({ uid: 90002, id: 'k_blot', up: true });
    const hand0 = s.hand.length;
    asPlayer(s, [{ op: 'copyCard', from: 'discard', mode: 'random', n: 1 }]);
    expect(s.hand.length).toBe(hand0 + 1);
    const copy = s.hand[s.hand.length - 1]!;
    expect(copy.id).toBe('k_blot');
    expect(copy.up).toBe(true);
    expect(copy.fleeting).toBe(true);
    expect(s.discard.some((x) => x.uid === 90002)).toBe(true);
  });
  it('落款: spends all 墨迹 for damage', () => {
    const s = fight('k_yanqiu');
    pc(s).statuses.ink = 6;
    const hp0 = boss(s).hp;
    const card = { uid: 90003, id: 'k_signature', up: false };
    s.hand.push(card);
    s.sources.push({ color: 'K', ready: true }, { color: 'K', ready: true }, { color: 'N', ready: true });
    expect(act(s, { type: 'play', card: card.uid, target: boss(s).uid }).ok).toBe(true);
    answer(s);
    expect(boss(s).hp).toBeLessThan(hp0 - 10);
    expect(pc(s).statuses.ink ?? 0).toBe(0);
  });
});

describe('傩面班', () => {
  it('a mask is a field worn one at a time; covering it never adds it to the discard pile', () => {
    const s = fight('w_fangxiang');
    expect(s.sides.player.field).toBeNull();
    asPlayer(s, [{ op: 'mask', next: true }]);
    expect(s.sides.player.field?.card).toBe('w_mask_nu');
    asPlayer(s, [{ op: 'mask', next: true }]);
    expect(s.sides.player.field?.card).toBe('w_mask_bei');
    asPlayer(s, [{ op: 'mask', next: true }, { op: 'mask', next: true }, { op: 'mask', next: true }]);
    expect(s.sides.player.field?.card).toBe('w_mask_nu');
    expect([...s.discard, ...s.hand, ...s.draw].some((x) => x.id.startsWith('w_mask_'))).toBe(false);
  });
  it('方相 换面 / 方相面: the first mask gives armor and draws', () => {
    const s = fight('w_fangxiang');
    const a0 = pc(s).armor, h0 = s.hand.length;
    asPlayer(s, [{ op: 'mask', card: 'w_mask_gui' }]);
    expect(pc(s).armor).toBe(a0 + 2);
    expect(s.hand.length).toBe(h0 + 2);
  });
  it('揭面 resolves the mask and fires 揭面 triggers (绛娘 谢幕)', () => {
    const s = fight('w_jiangniang');
    asPlayer(s, [{ op: 'mask', card: 'w_mask_xi' }]);
    const hp0 = boss(s).hp, hand0 = s.hand.length;
    asPlayer(s, [{ op: 'unmask' }]);
    expect(s.sides.player.field).toBeNull();
    expect(s.hand.length).toBe(hand0 + 4); // 喜面 draw 2 + 戏箱 draw 2
    expect(boss(s).hp).toBeLessThan(hp0); // 谢幕: 4 to all enemies
    expect(s.stats.unmasks).toBe(1);
  });
  it('面具 effects: 怒面 raises attack damage', () => {
    const s = fight('w_fangxiang');
    asPlayer(s, [{ op: 'mask', card: 'w_mask_nu' }]);
    const card = { uid: 90004, id: 'w_basic_strike', up: false };
    s.hand.push(card);
    const hp0 = boss(s).hp;
    act(s, { type: 'play', card: card.uid, target: boss(s).uid });
    answer(s);
    expect(hp0 - boss(s).hp).toBeGreaterThanOrEqual(6 + 1); // 怒面 +1
  });
});

describe('unlocks', () => {
  it('a profile past a threshold gets the commanders added to the track later', () => {
    const p = newProfile();
    p.xp = 9000;
    const labels = catchUpUnlocks(p);
    for (const id of ['r_zhuyan', 'g_qiuchan', 'b_guanshanyue', 'y_weishuo', 'p_yiqiu']) expect(p.unlocked.commanders).toContain(id);
    expect(p.unlocked.commanders).not.toContain('k_yanqiu');
    for (const l of ['祝炎、秋蝉 加入', '关山月、卫朔 加入', '弈秋 加入']) expect(labels).toContain(l);
    expect(catchUpUnlocks(p)).toEqual([]);
  });
  it('命书残页 open the new schools before 命数 does', () => {
    const p = newProfile();
    p.pages = PAGES.slice(0, 6).map((x) => x.id);
    catchUpUnlocks(p);
    expect(p.unlocked.commanders).toContain('k_yanqiu');
    expect(p.unlocked.commanders).not.toContain('w_fangxiang');
    p.pages = PAGES.slice(0, 12).map((x) => x.id);
    catchUpUnlocks(p);
    expect(p.unlocked.commanders).toContain('w_jiangniang');
  });
});

describe('真结局', () => {
  it('needs every act 1–3 boss page', () => {
    const all = PAGES.filter((x) => !x.boss.startsWith('e4_')).map((x) => x.id);
    expect(trueEndingReady({ pages: all.slice(1) })).toBe(false);
    expect(trueEndingReady({ pages: all })).toBe(true);
  });
  it('after 司命 the last page is offered; the choice leaves its flag and ends the run', () => {
    const r: RunState = newRun({ seed: 'true-end', commander: 'r_huojin', ascension: 0, trueEnding: true });
    expect(r.flags).toContain('true_end_ready');
    r.act = 4;
    r.screen = { k: 'bossRelic', options: [] };
    runAct(r, { t: 'bossRelic', i: null });
    expect(r.screen.k).toBe('finalChoice');
    runAct(r, { t: 'final', close: false });
    expect(r.flags).toContain('true_end_open');
    expect(r.result).toBe('win');
  });
});
