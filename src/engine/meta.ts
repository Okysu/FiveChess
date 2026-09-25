/**
 * Meta progression (局外): unlocks content *breadth* only — commanders, lieutenants, cards, relics, events.
 * No permanent numeric power. Pure functions over a serializable Profile.
 */
import { content } from './content';
import type { RunState } from './run/run';

export interface RunSummary {
  seed: string; commander: string; lieutenant: string | null; ascension: number; result: 'win' | 'lose' | 'abandon';
  act: number; floor: number; score: number; date: number; deck: string[]; relics: string[]; nemesis?: string;
  turns: number; maxDamage: number;
  /** replay data: combat + run action log */
  log?: unknown;
}

export interface Profile {
  v: 1;
  xp: number;
  runs: number;
  wins: number;
  tutorialDone: boolean;
  unlocked: { commanders: string[]; lieutenants: string[]; cardPacks: number; relicPacks: number; eventPacks: number };
  ascension: Record<string, number>; // highest unlocked ascension per commander
  commanderStats: Record<string, { runs: number; wins: number; bestFloor: number; highestAsc: number }>;
  discovered: { cards: string[]; enemies: string[]; relics: string[] };
  history: RunSummary[];
  hiddenUnlocked: boolean;
}

/** unlock track: thresholds in 命数 (xp) */
export const UNLOCK_TRACK: { xp: number; commanders?: string[]; cardPack?: boolean; relicPack?: boolean; eventPack?: boolean; lieutenants?: boolean; label: string }[] = [
  { xp: 0, commanders: ['r_huojin'], label: '初入命阙' },
  { xp: 1, commanders: ['b_shiyun', 'g_qingsi'], lieutenants: true, label: '石韫、青姒 加入' },
  { xp: 400, commanders: ['y_xuanji'], cardPack: true, label: '玄机子 加入 · 新卡牌' },
  { xp: 800, commanders: ['p_yetan'], relicPack: true, label: '夜昙 加入 · 新遗物' },
  { xp: 1300, commanders: ['r_liyuan'], cardPack: true, label: '离鸢 加入 · 新卡牌' },
  { xp: 1900, commanders: ['b_suxian'], eventPack: true, label: '素弦 加入 · 新事件' },
  { xp: 2600, commanders: ['g_acang'], cardPack: true, label: '阿苍 加入 · 新卡牌' },
  { xp: 3400, commanders: ['y_yanwujiu'], relicPack: true, label: '燕无咎 加入 · 新遗物' },
  { xp: 4300, commanders: ['p_liuxu'], cardPack: true, eventPack: true, label: '柳絮 加入 · 全部内容' },
];

export function newProfile(): Profile {
  return {
    v: 1, xp: 0, runs: 0, wins: 0, tutorialDone: false,
    unlocked: { commanders: ['r_huojin'], lieutenants: [], cardPacks: 0, relicPacks: 0, eventPacks: 0 },
    ascension: {}, commanderStats: {}, discovered: { cards: [], enemies: [], relics: [] }, history: [], hiddenUnlocked: false,
  };
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
  for (const step of UNLOCK_TRACK) {
    if (step.xp > before && step.xp <= p.xp || (step.xp === 1 && p.runs === 1)) {
      if (step.commanders) for (const c of step.commanders) if (!p.unlocked.commanders.includes(c)) p.unlocked.commanders.push(c);
      if (step.lieutenants && !p.unlocked.lieutenants.length) p.unlocked.lieutenants = ['*'];
      if (step.cardPack) p.unlocked.cardPacks++;
      if (step.relicPack) p.unlocked.relicPacks++;
      if (step.eventPack) p.unlocked.eventPacks++;
      if (!unlocked.includes(step.label)) unlocked.push(step.label);
    }
  }
  for (const k of ['cards', 'enemies', 'relics'] as const) for (const id of r.discovered[k]) if (!p.discovered[k].includes(id)) p.discovered[k].push(id);
  p.history.unshift(summary);
  p.history = p.history.slice(0, 60);
  return unlocked;
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
