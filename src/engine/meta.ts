/**
 * Meta progression (局外): unlocks content *breadth* only — commanders, lieutenants, cards, relics, events,
 * 开局祈命 packs, and per-commander 精通 (alternative starter relic / skill, titles). No permanent numeric power.
 * Pure functions over a serializable Profile.
 */
import { content } from './content';
import type { RunState } from './run/run';
import { checkAchievements } from './achievements';

export interface RunSummary {
  seed: string; commander: string; lieutenant: string | null; ascension: number; result: 'win' | 'lose' | 'abandon';
  act: number; floor: number; score: number; date: number; deck: string[]; relics: string[]; nemesis?: string;
  turns: number; maxDamage: number;
  /** replay data: combat + run action log */
  log?: unknown;
}

export interface Profile {
  v: 2;
  xp: number;
  runs: number;
  wins: number;
  tutorialDone: boolean;
  unlocked: { commanders: string[]; lieutenants: string[]; cardPacks: number; relicPacks: number; eventPacks: number; blessingPacks: number };
  ascension: Record<string, number>; // highest unlocked ascension per commander
  commanderStats: Record<string, { runs: number; wins: number; bestFloor: number; highestAsc: number }>;
  discovered: { cards: string[]; enemies: string[]; relics: string[] };
  history: RunSummary[];
  hiddenUnlocked: boolean;
  /** 精通: 命数 earned with each commander */
  mastery: Record<string, number>;
  /** chosen 精通 loadout per commander (only honoured once the level allows it) */
  loadout: Record<string, { altRelic?: boolean; altSkill?: boolean }>;
  /** one-time tips already shown (ui/hints.ts) */
  seenHints?: string[];
  /** 命途 claimed (engine/achievements.ts) */
  achievements?: string[];
  /** 兑换码 already used (engine/redeem.ts redeemKey) */
  redeemed?: string[];
}

/** unlock track: thresholds in 命数 (xp) */
export const UNLOCK_TRACK: { xp: number; commanders?: string[]; cardPack?: boolean; relicPack?: boolean; eventPack?: boolean; blessingPack?: boolean; lieutenants?: boolean; label: string }[] = [
  { xp: 0, commanders: ['r_huojin'], label: '初入命阙' },
  { xp: 1, commanders: ['b_shiyun', 'g_qingsi'], lieutenants: true, label: '石韫、青姒 加入' },
  { xp: 400, commanders: ['y_xuanji'], cardPack: true, label: '玄机子 加入 · 新卡牌' },
  { xp: 800, commanders: ['p_yetan'], relicPack: true, label: '夜昙 加入 · 新遗物' },
  { xp: 1300, commanders: ['r_liyuan'], cardPack: true, label: '离鸢 加入 · 新卡牌' },
  { xp: 1900, commanders: ['b_suxian'], eventPack: true, label: '素弦 加入 · 新事件' },
  { xp: 2600, commanders: ['g_acang'], cardPack: true, label: '阿苍 加入 · 新卡牌' },
  { xp: 3400, commanders: ['y_yanwujiu'], relicPack: true, label: '燕无咎 加入 · 新遗物' },
  { xp: 4300, commanders: ['p_liuxu'], cardPack: true, eventPack: true, label: '柳絮 加入 · 全部内容' },
  // 1.0.1: the track goes on with 开局祈命 packs (the "pack" field in src/data/blessings.json)
  { xp: 5000, blessingPack: true, label: '新命签：奇遇、余烬常燃、点化' },
  { xp: 7000, blessingPack: true, label: '新命签：多源、贵人、轻装' },
  { xp: 9500, blessingPack: true, label: '新命签：藏珍、改命、孤注一掷' },
  { xp: 12000, label: '命书圆满（全部命签已解锁）' },
];

export function newProfile(): Profile {
  return {
    v: 2, xp: 0, runs: 0, wins: 0, tutorialDone: false,
    unlocked: { commanders: ['r_huojin'], lieutenants: [], cardPacks: 0, relicPacks: 0, eventPacks: 0, blessingPacks: 0 },
    ascension: {}, commanderStats: {}, discovered: { cards: [], enemies: [], relics: [] }, history: [], hiddenUnlocked: false,
    mastery: {}, loadout: {},
  };
}

/** save v1 → v2 (1.0.1): 精通 from the run history (at least 250 per recorded run), 命签 packs for 命数 already earned */
export function migrateProfileV1(d: unknown): Profile {
  const p = d as Omit<Profile, 'v' | 'mastery' | 'loadout'> & { v: number; mastery?: Profile['mastery']; loadout?: Profile['loadout'] };
  const mastery: Record<string, number> = {};
  for (const h of p.history ?? []) mastery[h.commander] = (mastery[h.commander] ?? 0) + (h.score ?? 0);
  for (const [id, st] of Object.entries(p.commanderStats ?? {})) mastery[id] = Math.max(mastery[id] ?? 0, st.runs * 250);
  const blessingPacks = UNLOCK_TRACK.filter((t) => t.blessingPack && t.xp <= (p.xp ?? 0)).length;
  return { ...p, v: 2, unlocked: { ...p.unlocked, blessingPacks }, mastery: p.mastery ?? mastery, loadout: p.loadout ?? {} } as Profile;
}

// ───────────── 精通 ─────────────

/** 命数 needed for 精通 level 1…10 (index = level - 1); about 15 runs to the top */
export const MASTERY_XP = [0, 200, 500, 900, 1400, 2000, 2700, 3500, 4400, 5400];
export const MASTERY_MAX = MASTERY_XP.length;
export const MASTERY_TITLES: Record<number, string> = { 2: '初识', 6: '知己', 10: '命契' };

export function masteryLevel(xp: number): number {
  let lv = 1;
  for (let i = 0; i < MASTERY_XP.length; i++) if (xp >= MASTERY_XP[i]!) lv = i + 1;
  return lv;
}

/** what reaching a level gives (select screen + the run-end unlock list) */
export function masteryReward(cmdId: string, lv: number): string | null {
  const c = content().commanders.get(cmdId);
  if (!c) return null;
  if (MASTERY_TITLES[lv]) return `称号「${c.name}·${MASTERY_TITLES[lv]}」`;
  if (lv === 3 && c.alt) return `第二件起始遗物「${content().relics.get(c.alt.relic)?.name ?? c.alt.relic}」`;
  if (lv === 5 && c.alt) return `「另一面」技能「${c.alt.skill.name}」`;
  if (lv === 8) return '开局祈命多一个可选命签';
  return null;
}

export function masteryTitle(p: Profile, cmdId: string): string | null {
  const lv = masteryLevel(p.mastery[cmdId] ?? 0);
  const best = Object.keys(MASTERY_TITLES).map(Number).filter((l) => l <= lv).sort((a, b) => b - a)[0];
  return best ? `${content().commander(cmdId).name}·${MASTERY_TITLES[best]}` : null;
}

/** the loadout this commander may actually use now */
export function effectiveLoadout(p: Profile, cmdId: string): { altRelic: boolean; altSkill: boolean } {
  const lv = masteryLevel(p.mastery[cmdId] ?? 0);
  const want = p.loadout[cmdId] ?? {};
  const has = !!content().commanders.get(cmdId)?.alt;
  return { altRelic: has && lv >= 3 && !!want.altRelic, altSkill: has && lv >= 5 && !!want.altSkill };
}

// ───────────── 开局祈命 ─────────────

/** 命签 unlocked by the 命数 track */
export function blessingPool(p: Profile): string[] {
  return [...content().blessings.values()].filter((b) => b.pack <= (p.unlocked.blessingPacks ?? 0)).map((b) => b.id).sort();
}

/** how many 命签 to offer: 3, only 2 from 逆命 10, one more at 精通 8 with this commander */
export function blessingCount(p: Profile, cmdId: string, ascension: number): number {
  return (ascension >= 10 ? 2 : 3) + (masteryLevel(p.mastery[cmdId] ?? 0) >= 8 ? 1 : 0);
}

/** deterministic locked-content packs derived from content ids */
function packs() {
  const c = content();
  const lockCards: string[][] = [[], [], [], []];
  const byFaction = new Map<string, string[]>();
  for (const card of c.cards.values()) {
    if (card.pool === false || ['basic', 'token', 'special'].includes(card.rarity) || card.type === 'status' || card.type === 'curse') continue;
    if (card.rarity !== 'legendary' && card.rarity !== 'epic') continue;
    const arr = byFaction.get(card.faction) ?? [];
    arr.push(card.id);
    byFaction.set(card.faction, arr);
  }
  for (const arr of byFaction.values()) {
    arr.sort();
    // lock 4 of each faction's epic/legendary cards, spread across 4 packs
    arr.slice(0, 4).forEach((id, i) => lockCards[i]!.push(id));
  }
  const relics = [...c.relics.values()].filter((r) => r.tier === 'rare' || r.tier === 'boss').map((r) => r.id).sort();
  const lockRelics = [relics.slice(0, Math.ceil(relics.length / 4)), relics.slice(Math.ceil(relics.length / 4), Math.ceil(relics.length / 2))];
  const events = [...c.events.values()].filter((e) => !e.requires).map((e) => e.id).sort();
  const lockEvents = [events.slice(0, 5), events.slice(5, 10)];
  return { lockCards, lockRelics, lockEvents };
}

export function lockedContent(p: Profile): { cards: string[]; relics: string[]; events: string[]; lieutenants: string[] } {
  const { lockCards, lockRelics, lockEvents } = packs();
  return {
    cards: lockCards.slice(p.unlocked.cardPacks).flat(),
    relics: lockRelics.slice(p.unlocked.relicPacks).flat(),
    events: lockEvents.slice(p.unlocked.eventPacks).flat(),
    lieutenants: [], // all lieutenants are available (the unlock step only announces recruiting); never snapshot ids
  };
}

export function runScore(r: RunState): number {
  return r.stats.floors * 5 + r.stats.elites * 20 + r.stats.bosses * 60 + (r.result === 'win' ? 300 : 0) + r.ascension * 25 + Math.floor(r.stats.maxDamage / 10);
}

/** apply a finished run to the profile; returns newly unlocked labels */
export function recordRun(p: Profile, r: RunState, summary: RunSummary): string[] {
  const unlocked: string[] = [];
  p.runs++;
  if (summary.result === 'win') p.wins++;
  p.tutorialDone = true;
  const before = p.xp;
  p.xp += summary.score;
  const mBefore = p.mastery[r.commander] ?? 0;
  p.mastery[r.commander] = mBefore + summary.score;
  const lv0 = masteryLevel(mBefore), lv1 = masteryLevel(p.mastery[r.commander]!);
  for (let lv = lv0 + 1; lv <= lv1; lv++) {
    const reward = masteryReward(r.commander, lv);
    unlocked.push(`${content().commander(r.commander).name} 精通 ${lv}${reward ? `：${reward}` : ''}`);
  }
  const st = (p.commanderStats[r.commander] ??= { runs: 0, wins: 0, bestFloor: 0, highestAsc: 0 });
  st.runs++;
  if (summary.result === 'win') {
    st.wins++;
    st.highestAsc = Math.max(st.highestAsc, r.ascension);
    const cur = p.ascension[r.commander] ?? 0;
    if (r.ascension >= cur && cur < 15) { p.ascension[r.commander] = cur + 1; unlocked.push(`逆命 ${cur + 1} 已开放（${content().commander(r.commander).name}）`); }
    if (!p.hiddenUnlocked) { p.hiddenUnlocked = true; unlocked.push('命书深处似乎还有什么在等待……'); }
  }
  st.bestFloor = Math.max(st.bestFloor, summary.floor);
  for (const k of ['cards', 'enemies', 'relics'] as const) for (const id of r.discovered[k]) if (!p.discovered[k].includes(id)) p.discovered[k].push(id);
  // 命途: before the unlock track, so their 命数 can open an unlock this run
  unlocked.push(...checkAchievements(p, r, summary));
  for (const label of applyUnlockTrack(p, before, p.runs === 1)) if (!unlocked.includes(label)) unlocked.push(label);
  p.history.unshift(summary);
  p.history = p.history.slice(0, 60);
  return unlocked;
}

/** grant every unlock-track step whose threshold lies in (before, p.xp] — for run rewards and 兑换码 alike */
export function applyUnlockTrack(p: Profile, before: number, firstRun = false): string[] {
  const out: string[] = [];
  for (const step of UNLOCK_TRACK) {
    if ((step.xp > before && step.xp <= p.xp) || (firstRun && step.xp === 1)) {
      if (step.commanders) for (const c of step.commanders) if (!p.unlocked.commanders.includes(c)) p.unlocked.commanders.push(c);
      if (step.lieutenants && !p.unlocked.lieutenants.length) p.unlocked.lieutenants = ['*'];
      if (step.cardPack) p.unlocked.cardPacks++;
      if (step.relicPack) p.unlocked.relicPacks++;
      if (step.eventPack) p.unlocked.eventPacks++;
      if (step.blessingPack) p.unlocked.blessingPacks = (p.unlocked.blessingPacks ?? 0) + 1;
      out.push(step.label);
    }
  }
  return out;
}

export function nextUnlock(p: Profile) {
  return UNLOCK_TRACK.find((s) => s.xp > p.xp) ?? null;
}

/** 逆命 levels (cumulative); shown on the commander screen. Keep in sync with the ascension checks in engine code. */
export const ASCENSION_TEXT: string[] = [
  '标准难度',
  '精英出现更频繁',
  '普通敌人生命 +10%',
  '精英生命 +10%',
  '首领生命 +10%',
  '首领战后只恢复 75% 缺失生命',
  '开局生命 -10%',
  '余烬上限 -1',
  '普通敌人伤害 +1',
  '商店价格 +10%',
  '牌组起始加入诅咒「宿业」',
  '初始源 -1',
  '升级卡牌奖励概率减半',
  '天命牌堆加入 4 张「凶兆」',
  '敌人获得 1 层初始灵障',
  '终幕首领获得第三阶段',
];
