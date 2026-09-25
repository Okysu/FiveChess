/**
 * Content tables for design review: every card, relic, potion, enemy, encounter, event, commander.
 *   npm run export:tables   → docs/数据表/*.md (readable) + docs/数据表/content.json (machine-readable)
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadContent } from './load-content';
import { content } from '../src/engine/content';
import { COLOR_INFO, KEYWORDS } from '../src/engine/glossary';
import type { Cost } from '../src/engine/defs';

loadContent();
const c = content();
const OUT = 'docs/数据表';
fs.mkdirSync(OUT, { recursive: true });

const esc = (s: unknown) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').replace(/\[|\]/g, '');
const table = (head: string[], rows: unknown[][]) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`)].join('\n');
const costText = (k: Cost) => `${k.g === 'X' ? 'X' : k.g}${(k.c ?? []).map((x) => COLOR_INFO[x].name).join('')}`;
const TYPE: Record<string, string> = { unit: '随从', tactic: '战术', response: '应对', delay: '延时', field: '阵地', equip: '装备', status: '状态', curse: '诅咒' };
const RARITY: Record<string, string> = { basic: '基础', common: '普通', rare: '稀有', epic: '史诗', legendary: '传说', token: '衍生', special: '特殊' };

const cards = [...c.cards.values()].sort((a, b) => a.faction.localeCompare(b.faction) || a.id.localeCompare(b.id));
const relics = [...c.relics.values()].sort((a, b) => a.tier.localeCompare(b.tier) || a.id.localeCompare(b.id));
const potions = [...c.potions.values()].sort((a, b) => a.rarity.localeCompare(b.rarity) || a.id.localeCompare(b.id));
const enemies = [...c.enemies.values()].filter((e) => !e.id.startsWith('sandbox')).sort((a, b) => a.act - b.act || a.tier.localeCompare(b.tier) || a.id.localeCompare(b.id));
const encounters = [...c.encounters.values()].filter((e) => e.id !== 'sandbox').sort((a, b) => a.act - b.act || a.tier.localeCompare(b.tier) || a.id.localeCompare(b.id));
const events = [...c.events.values()].sort((a, b) => Math.min(...a.acts) - Math.min(...b.acts) || a.id.localeCompare(b.id));
const commanders = [...c.commanders.values()];
const lieutenants = [...c.lieutenants.values()];

const write = (name: string, title: string, body: string) => fs.writeFileSync(path.join(OUT, `${name}.md`), `# ${title}\n\n> 由 \`npm run export:tables\` 自动生成，请勿手改。\n\n${body}\n`);

for (const f of Object.keys(COLOR_INFO)) {
  const list = cards.filter((x) => x.faction === f);
  if (!list.length) continue;
  write(`卡牌_${COLOR_INFO[f as keyof typeof COLOR_INFO].name}`, `卡牌 · ${COLOR_INFO[f as keyof typeof COLOR_INFO].name}（${list.length} 张）`,
    table(['ID', '名称', '类型', '稀有度', '费用', '身材', '关键词', '规则'], list.map((x) => [
      x.id, x.name, TYPE[x.type] ?? x.type, RARITY[x.rarity] ?? x.rarity, costText(x.cost),
      x.unit ? `${x.unit.atk}/${x.unit.hp}` : '', [...(x.keywords ?? []), ...(x.unit?.keywords ?? [])].map((k) => KEYWORDS[k]?.name ?? k).join('、'), x.text,
    ])));
}
write('遗物', `遗物（${relics.length} 件，规则改变型 ${relics.filter((r) => r.ruleChanging).length} 件）`,
  table(['ID', '名称', '层级', '流派', '规则改变', '效果'], relics.map((r) => [r.id, r.name, r.tier, r.faction ? COLOR_INFO[r.faction].name : '', r.ruleChanging ? '是' : '', r.text])));
write('丹药', `丹药（${potions.length} 种）`, table(['ID', '名称', '稀有度', '效果'], potions.map((p) => [p.id, p.name, p.rarity, p.text])));
write('敌人', `敌人（${enemies.length} 种）`,
  table(['ID', '名称', '幕', '层级', '生命', '攻击', '关键词', '招式'], enemies.map((e) => [e.id, e.name, e.act, e.tier, e.hp[0] === e.hp[1] ? e.hp[0] : `${e.hp[0]}–${e.hp[1]}`, e.atk, (e.keywords ?? []).map((k) => KEYWORDS[k]?.name ?? k).join('、'), Object.values(e.moves ?? {}).map((m) => m.name).join('、')])));
write('遭遇战', `遭遇战（${encounters.length} 场）`,
  table(['ID', '幕', '层级', '池', '敌人'], encounters.map((e) => [e.id, e.act, e.tier, e.pool ?? '', e.enemies.map((x) => c.enemies.get(x.id)?.name ?? x.id).join('、')])));
write('事件', `事件（${events.length} 个）`, table(['ID', '标题', '幕', '选项数'], events.map((e) => [e.id, e.title, e.acts.join(','), e.options.length])));
write('主帅与副将', `主帅（${commanders.length}）与副将（${lieutenants.length}）`,
  table(['ID', '名称', '称号', '流派', '生命', '技能'], commanders.map((x) => [x.id, x.name, x.title, COLOR_INFO[x.faction].name, x.hp, x.skills.map((s) => s.name).join('、')])) + '\n\n' +
  table(['ID', '名称', '称号', '流派', '技能'], lieutenants.map((x) => [x.id, x.name, x.title, COLOR_INFO[x.faction].name, x.skill.name])));

fs.writeFileSync(path.join(OUT, 'content.json'), JSON.stringify({ generated: new Date().toISOString(), cards, relics, potions, enemies, encounters, events, commanders, lieutenants }, null, 1));
console.log(`exported ${cards.length} cards, ${relics.length} relics, ${potions.length} potions, ${enemies.length} enemies, ${encounters.length} encounters, ${events.length} events → ${OUT}`);
