/**
 * 命途 (achievements): checked when a run is recorded; each one is claimed once and pays a one-time 命数 reward.
 * Breadth only — no permanent numbers. Some also track progress for the codex tab.
 */
import { content } from './content';
import { codexProgress } from './collection';
import { masteryLevel, MASTERY_MAX, type Profile, type RunSummary } from './meta';
import type { RunState } from './run/run';

export interface AchCtx { p: Profile; r: RunState; s: RunSummary }
export interface Achievement {
  id: string;
  name: string;
  text: string;
  /** one-time 命数 */
  reward: number;
  group: '征途' | '主帅' | '逆命' | '战技' | '行囊' | '收藏';
  done(c: AchCtx): boolean;
  /** [current, goal] for the codex progress bar, from the profile alone */
  progress?(p: Profile): [number, number];
}

const win = (c: AchCtx) => c.s.result === 'win';
const st = (c: AchCtx) => c.r.stats;
const winsWith = (p: Profile, id: string) => p.commanderStats[id]?.wins ?? 0;

const COMMANDER_ACH: [string, string][] = [
  ['r_huojin', '断刀重铸'], ['b_shiyun', '山崩不死'], ['g_qingsi', '建木逢春'], ['p_yetan', '昙花夜放'], ['r_liyuan', '朱雀涅槃'],
  ['b_suxian', '寒川一曲'], ['g_acang', '枯木逢荣'], ['y_xuanji', '窥破天机'], ['y_yanwujiu', '一卦成谶'], ['p_liuxu', '柳絮随风'],
];

let cache: Achievement[] | null = null;
/** built on first use: the texts need the loaded content (and meta.ts imports this module) */
export function achievements(): Achievement[] {
  return (cache ??= build());
}

function build(): Achievement[] {
  return [
  // 征途
  { id: 'ach_first_run', name: '初入命阙', text: '完成一局冒险（胜负不论）。', reward: 50, group: '征途', done: () => true },
  { id: 'ach_first_win', name: '逆命而行', text: '首次通关。', reward: 200, group: '征途', done: win },
  { id: 'ach_runs_20', name: '百折不回', text: '累计出征 20 局。', reward: 150, group: '征途', done: (c) => c.p.runs >= 20, progress: (p) => [p.runs, 20] },
  { id: 'ach_wins_5', name: '五度逆命', text: '累计通关 5 次。', reward: 300, group: '征途', done: (c) => c.p.wins >= 5, progress: (p) => [p.wins, 5] },
  { id: 'ach_hidden', name: '无名之名', text: '击败命书深处的无名者。', reward: 300, group: '征途', done: (c) => win(c) && c.r.flags.includes('hidden_boss') && !c.r.flags.includes('hidden_boss_lost') },
  { id: 'ach_act1_boss', name: '第一幕落', text: '击败第一幕首领。', reward: 60, group: '征途', done: (c) => st(c).bosses >= 1 },
  // 主帅
  ...COMMANDER_ACH.map(([id, name]): Achievement => ({
    id: `ach_win_${id}`, name, text: `以${content().commanders.get(id)?.name ?? id}通关。`, reward: 100, group: '主帅',
    done: (c) => win(c) && c.r.commander === id,
  })),
  { id: 'ach_five_schools', name: '五派同归', text: '以五个流派的主帅各通关一次。', reward: 400, group: '主帅',
    done: (c) => fiveSchools(c.p) >= 5, progress: (p) => [fiveSchools(p), 5] },
  { id: 'ach_mastery_max', name: '命契', text: `任一主帅精通达到 ${MASTERY_MAX} 级。`, reward: 300, group: '主帅',
    done: (c) => Object.values(c.p.mastery).some((x) => masteryLevel(x) >= MASTERY_MAX),
    progress: (p) => [Math.max(1, ...Object.values(p.mastery).map(masteryLevel)), MASTERY_MAX] },
  { id: 'ach_all_commanders', name: '群贤毕至', text: '解锁全部 10 位主帅。', reward: 150, group: '主帅',
    done: (c) => c.p.unlocked.commanders.length >= 10, progress: (p) => [p.unlocked.commanders.length, 10] },
  // 逆命
  { id: 'ach_asc_1', name: '初试逆命', text: '在逆命 1 或更高通关。', reward: 100, group: '逆命', done: (c) => win(c) && c.s.ascension >= 1 },
  { id: 'ach_asc_5', name: '逆命五重', text: '在逆命 5 或更高通关。', reward: 200, group: '逆命', done: (c) => win(c) && c.s.ascension >= 5 },
  { id: 'ach_asc_10', name: '逆命十重', text: '在逆命 10 或更高通关。', reward: 300, group: '逆命', done: (c) => win(c) && c.s.ascension >= 10 },
  { id: 'ach_asc_15', name: '命书焚尽', text: '在逆命 15 通关。', reward: 500, group: '逆命', done: (c) => win(c) && c.s.ascension >= 15 },
  // 战技（一局之内）
  { id: 'ach_sacrifice_30', name: '以身为薪', text: '一局内献牌 30 次。', reward: 100, group: '战技', done: (c) => (st(c).sacrifices ?? 0) >= 30 },
  { id: 'ach_cards_200', name: '手不释卷', text: '一局内打出 200 张牌。', reward: 100, group: '战技', done: (c) => st(c).cardsPlayed >= 200 },
  { id: 'ach_big_fight', name: '摧枯拉朽', text: '一场战斗内造成 150 点伤害。', reward: 150, group: '战技', done: (c) => st(c).maxDamage >= 150 },
  { id: 'ach_responses_20', name: '后发先至', text: '一局内打出 20 张应对牌。', reward: 100, group: '战技', done: (c) => (st(c).responses ?? 0) >= 20 },
  { id: 'ach_judges_30', name: '天命在我', text: '一局内进行 30 次判定。', reward: 100, group: '战技', done: (c) => (st(c).judges ?? 0) >= 30 },
  { id: 'ach_discards_40', name: '弃子争先', text: '一局内弃置 40 张牌。', reward: 100, group: '战技', done: (c) => (st(c).discards ?? 0) >= 40 },
  { id: 'ach_kills_60', name: '万夫莫敌', text: '一局内消灭 60 个敌方单位。', reward: 100, group: '战技', done: (c) => (st(c).kills ?? 0) >= 60 },
  { id: 'ach_flawless_boss', name: '片甲不伤', text: '无伤击败一名首领。', reward: 200, group: '战技', done: (c) => (st(c).flawlessBoss ?? 0) >= 1 },
  { id: 'ach_flawless_10', name: '行云流水', text: '一局内无伤赢下 10 场战斗。', reward: 150, group: '战技', done: (c) => (st(c).flawless ?? 0) >= 10 },
  { id: 'ach_no_attack_win', name: '不战屈人', text: '主帅一次也不攻击，通关。', reward: 200, group: '战技', done: (c) => win(c) && (st(c).cmdAttacks ?? 0) === 0 },
  // 行囊（一局之内）
  { id: 'ach_lean_deck', name: '少即是多', text: '以不超过 15 张牌的牌组通关。', reward: 250, group: '行囊', done: (c) => win(c) && c.r.deck.length <= 15 },
  { id: 'ach_fat_deck', name: '包罗万象', text: '牌组达到 40 张。', reward: 100, group: '行囊', done: (c) => c.r.deck.length >= 40 },
  { id: 'ach_rich', name: '富可敌国', text: '一局内同时持有 500 金。', reward: 100, group: '行囊', done: (c) => (st(c).maxGold ?? 0) >= 500 },
  { id: 'ach_relics_15', name: '百宝在身', text: '一局内持有 15 件遗物。', reward: 150, group: '行囊', done: (c) => c.r.relics.length >= 15 },
  { id: 'ach_boss_relics_3', name: '三宝', text: '一局内持有 3 件首领遗物。', reward: 150, group: '行囊',
    done: (c) => c.r.relics.filter((x) => content().relics.get(x.id)?.tier === 'boss').length >= 3 },
  { id: 'ach_no_blessing', name: '不问天意', text: '不取命签，通关。', reward: 150, group: '行囊', done: (c) => win(c) && c.r.blessing === null },
  { id: 'ach_lieutenant', name: '贵人相助', text: '带着副将通关。', reward: 100, group: '行囊', done: (c) => win(c) && !!c.r.lieutenant },
  { id: 'ach_alone', name: '独行', text: '不招募副将，通关。', reward: 150, group: '行囊', done: (c) => win(c) && !c.r.lieutenant },
  // 收藏
  { id: 'ach_codex_50', name: '博览', text: '图鉴收集达到 50%。', reward: 150, group: '收藏', done: (c) => codexProgress(c.p).pct >= 0.5, progress: (p) => [Math.round(codexProgress(p).pct * 100), 50] },
  { id: 'ach_codex_80', name: '通识', text: '图鉴收集达到 80%。', reward: 250, group: '收藏', done: (c) => codexProgress(c.p).pct >= 0.8, progress: (p) => [Math.round(codexProgress(p).pct * 100), 80] },
  { id: 'ach_codex_100', name: '万象归书', text: '图鉴收集达到 100%。', reward: 500, group: '收藏', done: (c) => codexProgress(c.p).pct >= 0.999, progress: (p) => [Math.round(codexProgress(p).pct * 100), 100] },
  { id: 'ach_all_blessings', name: '命签尽得', text: '解锁全部命签。', reward: 200, group: '收藏', done: (c) => (c.p.unlocked.blessingPacks ?? 0) >= 3, progress: (p) => [p.unlocked.blessingPacks ?? 0, 3] },
  ];
}

function fiveSchools(p: Profile): number {
  const f = new Set<string>();
  for (const [id, stc] of Object.entries(p.commanderStats)) if (stc.wins > 0) { const c = content().commanders.get(id); if (c) f.add(c.faction); }
  return f.size;
}

/** claim everything newly earned; returns notices for the run-end screen */
export function checkAchievements(p: Profile, r: RunState, s: RunSummary): string[] {
  p.achievements ??= [];
  const out: string[] = [];
  for (const a of achievements()) {
    if (p.achievements.includes(a.id)) continue;
    let ok = false;
    try { ok = a.done({ p, r, s }); } catch { ok = false; }
    if (!ok) continue;
    p.achievements.push(a.id);
    p.xp += a.reward;
    out.push(`命途「${a.name}」（命数 +${a.reward}）`);
  }
  return out;
}
