/** 图鉴 (UI研究笔记 §14.7): cards, enemies, relics, commanders, fate, world, rules, run history. */
import { Container, Sprite, Text } from 'pixi.js';
import { fs } from '../ui/profile';
import { panel as uiPanel, maskRect, uiSprite, INSET } from '../ui/skin';
import { G, Scene } from '../core/app';
import { assets, K } from '../assets';
import { content } from '../../engine/content';
import { Button, Modal, Tooltip, hideTip, showTip, title, toast } from '../ui/widgets';
import { C, FONT_BODY, FONT_TITLE, factionColor } from '../ui/theme';
import { CardView } from '../ui/card';
import { ScrollBox } from '../ui/scroll';
import { iconSprite } from '../ui/draw';
import { inspectCard, sortCards } from '../ui/hud';
import { session } from '../state';
import { COLOR_INFO, SUIT_INFO, plainRules } from '../../engine/glossary';
import { SUITS, type Color } from '../../engine/defs';
import { FateCardView } from './combat/fateView';
import world from '../../data/lore/world.json';
import rules from '../../data/lore/rules.json';
import { audio } from '../audio/audio';
import { codexProgress } from '../../engine/collection';
import { achievements } from '../../engine/achievements';
import { masteryLevel, PAGES } from '../../engine/meta';

type Tab = 'cards' | 'enemies' | 'relics' | 'commanders' | 'fate' | 'world' | 'pages' | 'rules' | 'history' | 'stats' | 'achievements';
const TABS: [Tab, string][] = [['cards', '卡牌'], ['enemies', '敌人'], ['relics', '遗物'], ['commanders', '主帅'], ['fate', '天命'], ['world', '世界'], ['pages', '残卷'], ['rules', '规则'], ['history', '对局记录'], ['stats', '统计'], ['achievements', '命途']];

class CodexPanel extends Container {
  private tab: Tab = 'cards';
  private body = new Container();
  private filter: Color | 'all' = 'all';

  constructor(private w: number, private h: number) {
    super();
    this.addChild(this.body);
    this.render();
  }

  private disc() {
    const p = session.profile.discovered;
    const r = session.run?.discovered;
    const merge = (a: string[], b?: string[]) => new Set([...a, ...(b ?? [])]);
    return { cards: merge(p.cards, r?.cards), enemies: merge(p.enemies, r?.enemies), relics: merge(p.relics, r?.relics) };
  }

  render() {
    this.removeChildren().forEach((c) => { if (c !== this.body) c.destroy({ children: true }); });
    this.addChild(this.body);
    TABS.forEach(([k, n], i) => {
      const b = new Button(n, { width: 150, height: 52, fontSize: fs(22), kind: k === this.tab ? 'primary' : 'ghost', onClick: () => { this.tab = k; this.render(); } });
      b.position.set(20 + i * 160, 0);
      this.addChild(b);
    });
    this.body.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.body.position.set(0, 70);
    const H = this.h - 70;
    const d = this.disc();
    switch (this.tab) {
      case 'cards': {
        const colors: (Color | 'all')[] = ['all', 'R', 'B', 'G', 'Y', 'P', 'N'];
        colors.forEach((c, i) => {
          const b = new Button(c === 'all' ? '全部' : COLOR_INFO[c].name, { width: 100, height: 44, fontSize: fs(20), kind: this.filter === c ? 'primary' : 'ghost', onClick: () => { this.filter = c; this.render(); } });
          b.position.set(20 + i * 110, 0);
          this.body.addChild(b);
        });
        const all = sortCards([...content().cards.values()].filter((c) => c.pool !== false && !['token', 'special', 'basic'].includes(c.rarity) && c.type !== 'status' && c.type !== 'curse' && (this.filter === 'all' || c.faction === this.filter)).map((c) => ({ id: c.id, up: false })));
        const found = all.filter((c) => d.cards.has(c.id)).length;
        const cnt = new Text({ text: `收集 ${found}/${all.length}`, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: fs(24), fill: C.goldLight } });
        cnt.position.set(this.w - 220, 10);
        this.body.addChild(cnt);
        const box = new ScrollBox(this.w, H - 60);
        box.position.set(0, 60);
        const per = Math.floor(this.w / 170);
        all.forEach((c, i) => {
          const known = d.cards.has(c.id);
          const v = new CardView(c);
          v.scale.set(0.5);
          v.position.set(95 + (i % per) * 170, 120 + Math.floor(i / per) * 230);
          if (!known) { v.setFaceDown(true); v.alpha = 0.5; }
          v.eventMode = 'static';
          v.cursor = known ? 'pointer' : 'default';
          v.on('pointertap', () => { if (known && !box.wasDrag) inspectCard(c.id, false); });
          box.content.addChild(v);
        });
        box.refresh();
        this.body.addChild(box);
        break;
      }
      case 'enemies': {
        const box = new ScrollBox(this.w, H);
        const list = [...content().enemies.values()].filter((e) => e.tier !== 'minion' || d.enemies.has(e.id)).filter((e) => !e.id.startsWith('sandbox') && !e.variantOf).sort((a, b) => a.act - b.act || ['normal', 'elite', 'boss', 'minion'].indexOf(a.tier) - ['normal', 'elite', 'boss', 'minion'].indexOf(b.tier));
        const per = Math.floor(this.w / 200);
        list.forEach((e, i) => {
          const known = d.enemies.has(e.id);
          const c = new Container();
          c.position.set(20 + (i % per) * 200, 10 + Math.floor(i / per) * 240);
          const bg = uiPanel(184, 224, 'tile');
          c.addChild(bg);
          const m = maskRect(INSET.tile.x, INSET.tile.y, 184 - INSET.tile.x * 2, 168 - INSET.tile.y, 0);
          assets.with(K.enemy(e.id, e.tier === 'boss'), (t) => { const s = new Sprite(t); const k = Math.min(170 / t.height, 170 / t.width); s.scale.set(k); s.anchor.set(0.5, 1); s.position.set(92, 178); if (c.destroyed) return; c.addChild(m); s.mask = m; if (!known) { s.tint = 0; s.alpha = 0.6; } c.addChildAt(s, Math.min(1, c.children.length)); });
          const n = new Text({ text: known ? e.name : '？？？', style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: fs(22), fill: C.text } });
          n.anchor.set(0.5); n.position.set(92, 200);
          c.addChild(n);
          if (known) { c.eventMode = 'static'; c.on('pointerover', () => showTip(new Tooltip([{ title: `${e.name}（第${e.act}幕 · ${{ normal: '普通', elite: '精英', boss: '首领', minion: '仆从' }[e.tier]}）`, body: e.lore }], 420), c.x + 200 + 80, 200)); c.on('pointerout', hideTip); }
          box.content.addChild(c);
        });
        box.refresh();
        this.body.addChild(box);
        break;
      }
      case 'relics': {
        const box = new ScrollBox(this.w, H);
        const list = [...content().relics.values()].sort((a, b) => ['starter', 'common', 'uncommon', 'rare', 'boss', 'shop', 'event'].indexOf(a.tier) - ['starter', 'common', 'uncommon', 'rare', 'boss', 'shop', 'event'].indexOf(b.tier));
        const per = Math.floor(this.w / 110);
        list.forEach((r, i) => {
          const known = d.relics.has(r.id);
          const c = new Container();
          c.position.set(60 + (i % per) * 110, 60 + Math.floor(i / per) * 110);
          const bg = uiSprite(r.tier === 'boss' ? 'skill_disc_active' : 'skill_disc', 96, 96);
          c.addChild(bg);
          c.addChild(iconSprite('ui_relic', 60, '遗', C.gold));
          assets.with(K.relic(r.id), (t) => { const s = new Sprite(t); s.anchor.set(0.5); s.scale.set(76 / Math.max(t.width, t.height)); if (!known) { s.tint = 0; s.alpha = 0.5; } c.removeChildAt(1); c.addChild(s); });
          c.eventMode = 'static';
          c.on('pointerover', () => showTip(new Tooltip(known ? [{ title: r.name, body: r.text }, ...(r.flavor ? [{ body: r.flavor, color: C.textDim }] : [])] : [{ title: '？？？', body: '尚未获得' }], 380), c.x + 60 + 60, c.y + 100));
          c.on('pointerout', hideTip);
          box.content.addChild(c);
        });
        box.refresh();
        this.body.addChild(box);
        break;
      }
      case 'pages': {
        // 命书残页: one per boss, the story of the night the book was torn
        const box = new ScrollBox(this.w, H);
        const have = new Set(session.profile.pages ?? []);
        const head = new Text({ text: `命书残页 · 已收集 ${PAGES.filter((p) => have.has(p.id)).length}/${PAGES.length}　　每位首领第一次倒下时，会留下一页。`, style: { fontFamily: FONT_BODY, fontSize: fs(22), fill: C.textDim } });
        head.position.set(20, 10);
        box.content.addChild(head);
        let y = 10 + head.height + 24;
        for (const pg of PAGES) {
          const got = have.has(pg.id);
          const boss = content().enemies.get(pg.boss)?.name ?? pg.boss;
          const t = new Text({ text: got ? `残页·${pg.title}` : '残页·？？？', style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: fs(28), fill: got ? C.goldLight : C.textDim, stroke: { color: 0, width: 4 } } });
          t.position.set(20, y);
          box.content.addChild(t);
          y += t.height + 8;
          const bt = new Text({ text: got ? pg.text : `（残缺——击败「${boss}」后可得）`, style: { fontFamily: FONT_BODY, fontSize: fs(21), fill: got ? C.text : C.textDim, wordWrap: true, wordWrapWidth: this.w - 80, lineHeight: Math.round(fs(21) * 1.6), breakWords: true } });
          bt.position.set(40, y);
          box.content.addChild(bt);
          y += bt.height + 28;
        }
        box.refresh();
        this.body.addChild(box);
        break;
      }
      case 'commanders': {
        const box = new ScrollBox(this.w, H);
        let y = 10;
        for (const cm of content().commanders.values()) {
          const st = session.profile.commanderStats[cm.id];
          const unlocked = session.profile.unlocked.commanders.includes(cm.id);
          const t = new Text({ text: `${unlocked ? cm.name : '？？？'} 「${cm.title}」 · ${COLOR_INFO[cm.faction].school}`, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: fs(30), fill: factionColor(cm.faction), stroke: { color: 0, width: 4 } } });
          t.position.set(20, y);
          box.content.addChild(t);
          y += 44;
          const body = unlocked ? `${cm.lore}${st?.wins ? `\n\n【结局】${cm.ending}` : '\n\n（以此主帅通关后解锁结局）'}` : '尚未解锁。';
          const bt = new Text({ text: body, style: { fontFamily: FONT_BODY, fontSize: fs(21), fill: C.text, wordWrap: true, wordWrapWidth: this.w - 80, lineHeight: 34, breakWords: true } });
          bt.position.set(40, y);
          box.content.addChild(bt);
          y += bt.height + 30;
        }
        box.refresh();
        this.body.addChild(box);
        break;
      }
      case 'fate': {
        SUITS.forEach((s, row) => {
          const l = new Text({ text: `${SUIT_INFO[s].name}（${SUIT_INFO[s].yang ? '阳' : '阴'}）`, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: fs(26), fill: SUIT_INFO[s].color } });
          l.position.set(20, 30 + row * 150);
          this.body.addChild(l);
          for (let r = 1; r <= 13; r++) {
            const v = new FateCardView({ suit: s, rank: r, id: r });
            v.scale.set(0.62);
            v.position.set(230 + (r - 1) * 96, 80 + row * 150);
            this.body.addChild(v);
          }
        });
        const n = new Text({ text: '天命牌堆共 52 张，每场战斗重新洗混，双方共享。观星台、遗物与事件可以增删改冒险中的天命牌；逆命 13 起混入「凶兆」。', style: { fontFamily: FONT_BODY, fontSize: fs(20), fill: C.textDim, wordWrap: true, wordWrapWidth: this.w - 60, breakWords: true } });
        n.position.set(20, 640);
        this.body.addChild(n);
        break;
      }
      case 'world': case 'rules': {
        const entries = this.tab === 'world' ? (world as { title: string; text: string; category?: string }[]) : (rules as { title: string; text: string }[]);
        const box = new ScrollBox(this.w, H);
        let y = 10;
        for (const e of entries) {
          const t = new Text({ text: `${'category' in e && e.category ? `［${e.category}］` : ''}${e.title}`, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: fs(30), fill: C.goldLight } });
          t.position.set(20, y);
          box.content.addChild(t);
          y += 44;
          const bt = new Text({ text: plainRules(e.text), style: { fontFamily: FONT_BODY, fontSize: fs(21), fill: C.text, wordWrap: true, wordWrapWidth: this.w - 80, lineHeight: 34, breakWords: true } });
          bt.position.set(40, y);
          box.content.addChild(bt);
          y += bt.height + 26;
        }
        box.refresh();
        this.body.addChild(box);
        break;
      }
      case 'stats': {
        this.body.addChild(statsView(this.w, H));
        break;
      }
      case 'achievements': {
        this.body.addChild(achievementsView(this.w, H));
        break;
      }
      case 'history': {
        const hs = session.profile.history;
        if (!hs.length) { const t = new Text({ text: '尚无对局记录。', style: { fontFamily: FONT_BODY, fontSize: fs(26), fill: C.textDim } }); t.position.set(40, 40); this.body.addChild(t); break; }
        const box = new ScrollBox(this.w, H);
        hs.forEach((h, i) => {
          const cm = content().commanders.get(h.commander);
          const row = new Container();
          row.position.set(20, 10 + i * 70);
          const bg = uiPanel(this.w - 60, 60, 'row');
          row.addChild(bg);
          const res = h.result === 'win' ? '通关' : h.result === 'abandon' ? '放弃' : '败北';
          const t = new Text({ text: `${new Date(h.date).toLocaleString('zh-CN')}　${cm?.name ?? h.commander}　逆命${h.ascension}　${res}　第${h.act}幕第${h.floor}层　命数+${h.score}　种子 ${h.seed}`, style: { fontFamily: FONT_BODY, fontSize: fs(20), fill: h.result === 'win' ? 0x9adfa8 : C.text } });
          t.position.set(INSET.row.x, 16);
          row.addChild(t);
          const cp = new Button('复制种子', { width: 130, height: 44, fontSize: fs(18), kind: 'ghost', onClick: () => { void navigator.clipboard?.writeText(h.seed); toast('已复制种子'); } });
          cp.position.set(this.w - 210, 8);
          row.addChild(cp);
          box.content.addChild(row);
        });
        box.refresh();
        this.body.addChild(box);
        break;
      }
    }
  }
}

/** 统计: overall record, per-commander table, what ends runs, favourite cards (from the last 60 runs) */
function statsView(w: number, h: number): Container {
  const p = session.profile;
  const box = new ScrollBox(w, h);
  let y = 10;
  const line = (text: string, o: { size?: number; color?: number; x?: number; bold?: boolean } = {}) => {
    const t = new Text({ text, style: { fontFamily: o.bold ? FONT_TITLE : FONT_BODY, fontWeight: o.bold ? '900' : 'normal', fontSize: fs(o.size ?? 22), fill: o.color ?? C.text, wordWrap: true, wordWrapWidth: w - 80, breakWords: true } });
    t.position.set(o.x ?? 20, y);
    box.content.addChild(t);
    y += t.height + 8;
    return t;
  };
  const cp = codexProgress(p);
  const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '—');
  line('总览', { size: 30, color: C.goldLight, bold: true });
  line(`出征 ${p.runs} · 通关 ${p.wins}（胜率 ${pct(p.wins, p.runs)}）· 命数 ${p.xp}`);
  line(`图鉴收集 ${Math.round(cp.pct * 100)}%：卡牌 ${cp.cards[0]}/${cp.cards[1]} · 敌人 ${cp.enemies[0]}/${cp.enemies[1]} · 遗物 ${cp.relics[0]}/${cp.relics[1]}`);
  y += 16;
  line('主帅', { size: 30, color: C.goldLight, bold: true });
  const cols = [0, 200, 330, 460, 590, 740, 900];
  const head = ['主帅', '出征', '通关', '胜率', '最远层数', '最高逆命', '精通'];
  head.forEach((hd, i) => { const t = new Text({ text: hd, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: fs(21), fill: C.textDim } }); t.position.set(20 + cols[i]!, y); box.content.addChild(t); });
  y += 40;
  for (const id of p.unlocked.commanders) {
    const cm = content().commanders.get(id);
    if (!cm) continue;
    const st = p.commanderStats[id];
    const cells = [cm.name, String(st?.runs ?? 0), String(st?.wins ?? 0), pct(st?.wins ?? 0, st?.runs ?? 0), String(st?.bestFloor ?? 0), String(st?.highestAsc ?? 0), `${masteryLevel(p.mastery[id] ?? 0)} 级`];
    cells.forEach((c, i) => { const t = new Text({ text: c, style: { fontFamily: FONT_BODY, fontSize: fs(21), fill: i === 0 ? factionColor(cm.faction) : C.text } }); t.position.set(20 + cols[i]!, y); box.content.addChild(t); });
    y += 36;
  }
  y += 16;
  const hs = p.history.filter((x) => x.result !== 'abandon');
  line(`最近 ${hs.length} 局`, { size: 30, color: C.goldLight, bold: true });
  if (!hs.length) line('尚无对局记录。', { color: C.textDim });
  else {
    const avg = hs.reduce((a, x) => a + x.floor + (x.act - 1) * 15, 0) / hs.length;
    line(`平均走到第 ${Math.round(avg)} 层（按全程计）· 通关 ${hs.filter((x) => x.result === 'win').length} 局`);
    const count = (ids: string[]) => { const m = new Map<string, number>(); for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
    const nem = count(hs.filter((x) => x.result === 'lose' && x.nemesis).map((x) => x.nemesis!)).slice(0, 5);
    const encName = (id: string) => { const e = content().encounters.get(id); const first = e?.enemies[0]?.id; return (first && content().enemies.get(first)?.name) ?? id; };
    line('最常止步于：' + (nem.length ? nem.map(([id, n]) => `${encName(id)} ×${n}`).join('　') : '—'));
    const cards = count(hs.flatMap((x) => [...new Set(x.deck)]).filter((id) => { const d = content().cards.get(id); return d && d.rarity !== 'basic' && d.type !== 'curse' && d.type !== 'status'; })).slice(0, 8);
    line('最常带上的牌：' + (cards.length ? cards.map(([id, n]) => `${content().cards.get(id)!.name} ×${n}`).join('　') : '—'));
    const relics = count(hs.flatMap((x) => x.relics).filter((id) => content().relics.get(id)?.tier !== 'starter')).slice(0, 6);
    line('最常拿到的遗物：' + (relics.length ? relics.map(([id, n]) => `${content().relics.get(id)?.name ?? id} ×${n}`).join('　') : '—'));
  }
  box.refresh();
  return box;
}

/** 命途: every achievement by group, claimed ones lit, open ones with their progress */
function achievementsView(w: number, h: number): Container {
  const p = session.profile;
  const got = new Set(p.achievements ?? []);
  const list = achievements();
  const box = new ScrollBox(w, h);
  let y = 10;
  const head = new Text({ text: `已达成 ${list.filter((a) => got.has(a.id)).length} / ${list.length}　·　每项首次达成时获得一次命数`, style: { fontFamily: FONT_BODY, fontSize: fs(22), fill: C.textDim } });
  head.position.set(20, y);
  box.content.addChild(head);
  y += 50;
  for (const group of ['征途', '主帅', '逆命', '战技', '行囊', '收藏'] as const) {
    const gt = new Text({ text: group, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: fs(28), fill: C.goldLight } });
    gt.position.set(20, y);
    box.content.addChild(gt);
    y += 46;
    const items = list.filter((a) => a.group === group);
    const colW = Math.floor((w - 60) / 2);
    // build first: a row is as tall as its text (phone fonts wrap), both cells of a line share the taller height
    const cells = items.map((a) => {
      const done = got.has(a.id);
      const nm = new Text({ text: `${done ? '✓ ' : ''}${a.name}`, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: fs(22), fill: done ? 0x9adfa8 : C.text } });
      const pr = !done && a.progress ? a.progress(p) : null;
      const right = new Text({ text: pr ? `${Math.min(pr[0], pr[1])}/${pr[1]}　命数 +${a.reward}` : `命数 +${a.reward}`, style: { fontFamily: FONT_BODY, fontSize: fs(18), fill: done ? C.textDim : C.goldLight } });
      const tx = new Text({ text: a.text, style: { fontFamily: FONT_BODY, fontSize: fs(18), fill: C.textDim, wordWrap: true, wordWrapWidth: colW - INSET.row.x * 2, breakWords: true } });
      const top = 12 + nm.height + 4;
      return { done, nm, right, tx, top, h: Math.max(84, top + tx.height + 16) };
    });
    for (let i = 0; i < cells.length; i += 2) {
      const rowH = Math.max(cells[i]!.h, cells[i + 1]?.h ?? 0);
      for (const [k, cell] of [cells[i], cells[i + 1]].entries()) {
        if (!cell) continue;
        const row = new Container();
        row.position.set(20 + k * (colW + 20), y);
        const bg = uiPanel(colW, rowH, 'row');
        bg.alpha = cell.done ? 1 : 0.55;
        cell.nm.position.set(INSET.row.x, 12);
        cell.right.anchor.set(1, 0);
        cell.right.position.set(colW - INSET.row.x, 15);
        cell.tx.position.set(INSET.row.x, cell.top);
        row.addChild(bg, cell.nm, cell.right, cell.tx);
        box.content.addChild(row);
      }
      y += rowH + 8;
    }
    y += 12;
  }
  box.refresh();
  return box;
}

export class CodexScene extends Scene {
  override async enter() {
    await assets.load(K.bg('codex'));
    G.setBackdrop(assets.get(K.bg('codex')), 0x6a6a6a);
    audio.playMusic('camp');
    const t = title('图　鉴', 56);
    t.anchor.set(0.5, 0); t.position.set(960, 14);
    const back = new Button('← 返回', { width: 150, height: 56, fontSize: fs(22), kind: 'ghost', onClick: () => void import('./title').then((m) => G.go(new m.TitleScene())) });
    back.position.set(24, 20);
    const bg = uiPanel(1860, 960, 'dark');
    bg.position.set(30, 100);
    const panel = new CodexPanel(1860 - INSET.dark.x * 2, 960 - INSET.dark.y * 2);
    panel.position.set(30 + INSET.dark.x, 100 + INSET.dark.y);
    this.addChild(bg, panel, t, back);
  }
}

export function openCodexModal() {
  const m = new Modal(1800, 1000, { title: '图鉴' });
  const p = new CodexPanel(1800 - INSET.dark.x * 2, 1000 - 110 - INSET.dark.y);
  p.position.set(INSET.dark.x, 110);
  m.body.addChild(p);
}
