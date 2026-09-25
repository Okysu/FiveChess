/** Keyword & status glossary: display names, rules text, icon ids. Used by UI, validator and docs. */
import type { Keyword, StatusId, Suit, Color } from './defs';

export interface GlossEntry { name: string; text: string; icon: string; tint: number }

export const KEYWORDS: Record<Keyword, GlossEntry> = {
  taunt: { name: '坚守', text: '敌方普通攻击若能攻击到具有坚守的单位，必须以坚守单位为目标。', icon: 'kw_taunt', tint: 0x8fa3b8 },
  ranged: { name: '远射', text: '攻击无视距离；攻击单位时不受反击。', icon: 'kw_ranged', tint: 0x9fc27a },
  leap: { name: '奇袭', text: '攻击无视深度与坚守。', icon: 'kw_leap', tint: 0xc9a0e8 },
  haste: { name: '疾行', text: '入场当回合即可攻击。', icon: 'kw_haste', tint: 0xf2c46b },
  twinStrike: { name: '连斩', text: '每回合可攻击两次。', icon: 'kw_twin', tint: 0xe98a6a },
  ward: { name: '灵障', text: '抵消下一次受到的伤害（可叠层）。', icon: 'kw_ward', tint: 0xf5e6a8 },
  lifesteal: { name: '汲命', text: '造成伤害时，己方主帅恢复等量生命。', icon: 'kw_lifesteal', tint: 0xd65a6a },
  deathtouch: { name: '断魂', text: '对单位造成伤害即将其消灭；对主帅改为额外造成3点伤害。', icon: 'kw_deathtouch', tint: 0x7bd18f },
  thorns: { name: '棘刺', text: '受到近战攻击时，对攻击者造成X点伤害。', icon: 'kw_thorns', tint: 0x8fbf6a },
  battlecry: { name: '起势', text: '从手牌打出时触发。', icon: 'kw_battlecry', tint: 0xf0b45a },
  deathrattle: { name: '遗志', text: '死亡时触发。', icon: 'kw_deathrattle', tint: 0x9c8ec7 },
  growth: { name: '滋长', text: '我方回合开始时获得+X/+X。', icon: 'kw_growth', tint: 0x6fcf7f },
  aura: { name: '统御', text: '相邻友方单位获得所述效果（离场即失效）。', icon: 'kw_aura', tint: 0xe8d27a },
  stealth: { name: '隐匿', text: '不能被敌方选为目标，直到其攻击或造成伤害。', icon: 'kw_stealth', tint: 0x6f7da8 },
  response: { name: '应', text: '可在敌方宣告行动后，以余烬打出。', icon: 'kw_response', tint: 0xe0564a },
  judge: { name: '判定', text: '翻开天命牌顶，根据命纹或点数决定结果。', icon: 'kw_judge', tint: 0xf2d27a },
  delay: { name: '延时', text: '挂在目标身上，若干回合后判定。', icon: 'kw_delay', tint: 0xd9b45e },
  omen: { name: '天契', text: '当一次判定结果为指定命纹时触发。', icon: 'kw_omen', tint: 0xf7e3a1 },
  exhaust: { name: '燃尽', text: '打出后移出本场战斗。', icon: 'kw_exhaust', tint: 0xb07a5a },
  innate: { name: '本命', text: '战斗开始时必定在起手。', icon: 'kw_innate', tint: 0xa8d0e8 },
  retain: { name: '藏锋', text: '回合结束时不会被弃置。', icon: 'kw_retain', tint: 0x9aa8c8 },
  ethereal: { name: '浮光', text: '回合结束时若仍在手牌中，将其燃尽。', icon: 'kw_ethereal', tint: 0xc8e0f0 },
  combo: { name: '连势', text: '若本回合已打出过至少N张其他牌，获得额外效果。', icon: 'kw_combo', tint: 0xd08ae0 },
  offering: { name: '献', text: '当此牌被献出为源时触发。', icon: 'kw_offering', tint: 0xff9a5a },
  resonance: { name: '共鸣', text: '若你拥有至少N枚指定颜色的源，获得额外效果。', icon: 'kw_resonance', tint: 0xa0e0d0 },
};

export const STATUSES: Record<StatusId, GlossEntry & { debuff: boolean }> = {
  burn: { name: '灼烧', text: '回合开始时受到X点伤害，然后层数减半。', icon: 'st_burn', tint: 0xff7a3a, debuff: true },
  poison: { name: '中毒', text: '回合结束时受到X点伤害（无视护甲与灵障），然后层数-1。', icon: 'st_poison', tint: 0x8fd35a, debuff: true },
  freeze: { name: '冰冻', text: '不能攻击。回合结束时层数-1。', icon: 'st_freeze', tint: 0x8fd8ff, debuff: true },
  stun: { name: '眩晕', text: '跳过下一个行动。生效后短暂免疫眩晕。', icon: 'st_stun', tint: 0xf5e16a, debuff: true },
  vulnerable: { name: '易伤', text: '受到的伤害×1.5。回合结束时层数-1。', icon: 'st_vulnerable', tint: 0xe86a8a, debuff: true },
  weak: { name: '虚弱', text: '造成的攻击伤害×0.75。回合结束时层数-1。', icon: 'st_weak', tint: 0x9a8ac0, debuff: true },
  silence: { name: '封印', text: '失去所有关键词与能力。', icon: 'st_silence', tint: 0x7a7a8a, debuff: true },
  might: { name: '锋锐', text: '攻击伤害+X。', icon: 'st_might', tint: 0xff5a4a, debuff: false },
  tenacity: { name: '坚韧', text: '获得护甲时额外+X。', icon: 'st_tenacity', tint: 0x6aa8e8, debuff: false },
  regen: { name: '再生', text: '回合结束时恢复X点生命，然后层数-1。', icon: 'st_regen', tint: 0x6fe08a, debuff: false },
};

export const SUIT_INFO: Record<Suit, { name: string; yang: boolean; color: number; shape: string }> = {
  sun: { name: '日纹', yang: true, color: 0xf2a33a, shape: 'circle' },
  thunder: { name: '雷纹', yang: true, color: 0xa77be8, shape: 'bolt' },
  moon: { name: '月纹', yang: false, color: 0x8ec5f0, shape: 'crescent' },
  mountain: { name: '山纹', yang: false, color: 0x6fb58a, shape: 'triangle' },
};

export const COLOR_INFO: Record<Color, { name: string; school: string; hex: number; dark: number; light: number }> = {
  R: { name: '赤', school: '焚阳宗', hex: 0xc8321f, dark: 0x6a160c, light: 0xf08a5a },
  B: { name: '玄', school: '镇岳门', hex: 0x2a4f8a, dark: 0x14223e, light: 0x7aa2d8 },
  G: { name: '青', school: '万木庭', hex: 0x2f8a5f, dark: 0x143a26, light: 0x7ac89a },
  Y: { name: '金', school: '观星阁', hex: 0xd9a23a, dark: 0x6a4a10, light: 0xf5d68a },
  P: { name: '紫', school: '幽弈坊', hex: 0x6e3a78, dark: 0x2e1236, light: 0xb88ac8 },
  N: { name: '素', school: '中立', hex: 0xa89a80, dark: 0x4a4234, light: 0xe8dcc0 },
};

/** all bracket terms that may appear as [term] in rules text */
export const TERM_NAMES: Record<string, { kind: 'keyword' | 'status'; id: string }> = (() => {
  const m: Record<string, { kind: 'keyword' | 'status'; id: string }> = {};
  for (const [id, e] of Object.entries(KEYWORDS)) m[e.name] = { kind: 'keyword', id };
  for (const [id, e] of Object.entries(STATUSES)) m[e.name] = { kind: 'status', id };
  m['护甲'] = { kind: 'status', id: 'armor' };
  m['余烬'] = { kind: 'keyword', id: 'ember' };
  m['源'] = { kind: 'keyword', id: 'source' };
  m['命签'] = { kind: 'keyword', id: 'sign' };
  m['窥视'] = { kind: 'keyword', id: 'peek' };
  m['观星'] = { kind: 'keyword', id: 'stargaze' };
  m['改判'] = { kind: 'keyword', id: 'rejudge' };
  return m;
})();

export const EXTRA_TERMS: Record<string, string> = {
  护甲: '抵挡等量伤害。拥有者回合开始时清零。',
  余烬: '我方回合结束时至多保留2枚可用的源，只能用于支付【应】牌。',
  源: '献出手牌获得，本场战斗永久存在，每回合重置。',
  命签: '收入命签区的天命牌（上限2），可用于改判。',
  窥视: '查看天命牌堆顶的若干张。',
  观星: '查看天命牌堆顶若干张，任意重排或置底。',
  改判: '判定牌翻开后，打出一张命签替换它。',
};

/** plain-text form of card rules: "{a}" → the card's value (suit/pip tokens like {sun} are left for the rich-text renderer) */
export function fillVars(text: string, vars?: Record<string, number>): string {
  if (!vars) return text;
  return text.replace(/{(w+)}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
