/**
 * One-time tips (新手提示): each key is shown once per profile, only while 设置 → 战斗 → 新手提示 is on.
 * The tutorial run has its own scripted hints (combatScene.tutorialHints); these cover systems met later.
 */
import { Text } from 'pixi.js';
import { fs } from './profile';
import { Modal } from './widgets';
import { C, FONT_BODY } from './theme';
import { session } from '../state';

export const HINTS = {
  weapon: {
    title: '主帅与武器',
    text: '• 主帅要装备【武器】才能攻击：每回合一次，每次攻击消耗 1 点耐久。\n• 「主帅攻击时」一类效果都需要武器。武器牌在各派与中立的奖励、商店中都能找到。\n• 左侧的空武器槽可以悬停查看说明。',
  },
  sunder: {
    title: '首领 · 破甲',
    text: '• 首领的攻击带有【破甲】：每造成 1 点伤害击碎 2 点护甲，护甲只能挡住一半。\n• 首领战里单靠堆护甲撑不住，要留出输出或削弱手段。',
  },
  mastery: {
    title: '主帅精通',
    text: '• 每局获得的命数也会记入这位主帅的【精通】（共 10 级）。\n• 精通 3：第二件起始遗物　精通 5：「另一面」技能　精通 8：祈命多一支可选。\n• 在主帅选择页切换起始遗物与技能。',
  },
} as const;
export type HintKey = keyof typeof HINTS;

/** show a tip the first time; false when it was already seen or tips are off */
export function hintOnce(key: HintKey): boolean {
  const p = session.profile;
  if (!session.settings.tutorialHints) return false;
  p.seenHints ??= [];
  if (p.seenHints.includes(key)) return false;
  p.seenHints.push(key);
  void session.saveProfile();
  const h = HINTS[key];
  const m = new Modal(1000, 440, { title: h.title });
  const t = new Text({ text: h.text, style: { fontFamily: FONT_BODY, fontSize: fs(25), fill: C.text, lineHeight: 44, wordWrap: true, wordWrapWidth: 900, breakWords: true } });
  t.position.set(50, 110);
  m.body.addChild(t);
  return true;
}
