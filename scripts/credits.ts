/**
 * Credits from the asset manifest (+ fixed entries for code libraries and fonts).
 *   npm run credits → CREDITS.md (repo) + assets/credits.json (read by the in-game 鸣谢 page)
 * Third-party assets (e.g. CC0 audio) must be listed in assets/manifest.json with source_type 'free_asset'
 * or 'edited_free_asset', a source URL, an author and a license — they then appear here automatically.
 */
import fs from 'node:fs';

interface Entry { id: string; path: string; category: string; source_type: string; source: string; license: string; author?: string; url?: string }
const manifest = JSON.parse(fs.readFileSync('assets/manifest.json', 'utf8')) as { assets: Entry[] };

const generated = manifest.assets.filter((a) => a.source_type === 'ai_generated');
const byModel = new Map<string, Map<string, number>>();
for (const a of generated) {
  const model = a.source.split(' via ')[0] ?? a.source;
  const m = byModel.get(model) ?? new Map<string, number>();
  m.set(a.category, (m.get(a.category) ?? 0) + 1);
  byModel.set(model, m);
}
const CAT: Record<string, string> = { card: '卡牌插画', hero: '主帅与副将立绘', enemy: '敌人立绘', boss: '首领立绘', relic: '遗物', potion: '丹药', event: '事件插图', audio: '音效与音乐', background: '背景', icon: '图标', ui: '界面贴图', effect: '特效粒子', fate: '天命牌' };

const third = manifest.assets.filter((a) => a.source_type === 'free_asset' || a.source_type === 'edited_free_asset');
const thirdGroups = new Map<string, Entry[]>();
for (const a of third) { const k = `${a.author ?? '?'}|${a.url ?? a.source}|${a.license}`; thirdGroups.set(k, [...(thirdGroups.get(k) ?? []), a]); }

const LIBS = [
  { name: 'PixiJS', role: '渲染', license: 'MIT', url: 'https://pixijs.com' },
  { name: 'yoga-layout', role: '界面布局', license: 'MIT', url: 'https://github.com/facebook/yoga' },
  { name: 'zod', role: '数据校验', license: 'MIT', url: 'https://zod.dev' },
  { name: 'Vite / TypeScript', role: '构建与语言', license: 'MIT / Apache-2.0', url: 'https://vitejs.dev' },
];
const FONTS = [
  { name: 'Noto Serif SC', license: 'SIL Open Font License 1.1', url: 'https://fonts.google.com/noto/specimen/Noto+Serif+SC' },
  { name: 'Ma Shan Zheng（马善政毛笔楷书，logo 与标题）', license: 'SIL Open Font License 1.1', url: 'https://fonts.google.com/specimen/Ma+Shan+Zheng' },
];

const sections: { title: string; lines: string[] }[] = [
  { title: '制作', lines: ['《命阙》规则引擎、全部内容（卡牌、敌人、事件、遗物）、界面与演出：本项目原创。'] },
  {
    title: '美术与音频（AI 生成，统一木版年画风格）',
    lines: [
      `共 ${generated.length} 项（图像按《美术风格圣经》的提示词与风格参考图生成），逐项记录于 assets/manifest.json。`,
      ...[...byModel].map(([model, cats]) => `${model}：${[...cats].map(([k, n]) => `${CAT[k] ?? k} ${n}`).join('，')}`),
    ],
  },
  {
    title: '第三方素材',
    lines: third.length
      ? [...thirdGroups.values()].map((g) => `${g[0]!.author ?? '佚名'} · ${g[0]!.url ?? g[0]!.source} · ${g[0]!.license}（${g.length} 个文件）`)
      : ['无。音效与音乐为 WebAudio 实时合成（五声调式生成音乐、程序化音效）。'],
  },
  { title: '字体', lines: FONTS.map((f) => `${f.name} · ${f.license} · ${f.url}`) },
  { title: '开源库', lines: LIBS.map((l) => `${l.name}（${l.role}）· ${l.license} · ${l.url}`) },
  { title: '参考与致意', lines: ['界面研究参考了炉石传说、万智牌 Arena、符文之地传说、杀戮尖塔、三国杀等作品的公开资料，仅用于学习交互原理；本作的界面、图标与卡框均为原创设计。'] },
];

fs.writeFileSync('assets/credits.json', JSON.stringify({ generated: new Date().toISOString(), sections }, null, 1));
const md = ['# 制作与鸣谢', '', '> 由 `npm run credits` 从 assets/manifest.json 生成。', ''];
for (const s of sections) md.push(`## ${s.title}`, '', ...s.lines.map((l) => `- ${l}`), '');
fs.writeFileSync('CREDITS.md', md.join('\n'));
console.log(`credits: ${generated.length} generated, ${third.length} third-party files`);
