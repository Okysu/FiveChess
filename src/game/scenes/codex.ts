/** 图鉴 (UI研究笔记 §14.7): cards, enemies, relics, commanders, fate, world, rules, run history. */
import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { panelSurface } from '../ui/skin';
import { G, Scene } from '../core/app';
import { assets, K } from '../assets';
import { content } from '../../engine/content';
import { Button, Modal, Tooltip, hideTip, showTip, title, toast } from '../ui/widgets';
import { C, FONT_BODY, FONT_TITLE, factionColor } from '../ui/theme';
import { CardView } from '../ui/card';
import { ScrollBox } from '../ui/scroll';
import { iconSprite, drawPanel } from '../ui/draw';
import { inspectCard, sortCards } from '../ui/hud';
import { session } from '../state';
import { COLOR_INFO, SUIT_INFO } from '../../engine/glossary';
import { SUITS, type Color } from '../../engine/defs';
import { FateCardView } from './combat/fateView';
import world from '../../data/lore/world.json';
import rules from '../../data/lore/rules.json';
import { audio } from '../audio/audio';

type Tab = 'cards' | 'enemies' | 'relics' | 'commanders' | 'fate' | 'world' | 'rules' | 'history';
const TABS: [Tab, string][] = [['cards', '卡牌'], ['enemies', '敌人'], ['relics', '遗物'], ['commanders', '主帅'], ['fate', '天命'], ['world', '世界'], ['rules', '规则'], ['history', '对局记录']];

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
      const b = new Button(n, { width: 150, height: 52, fontSize: 22, kind: k === this.tab ? 'primary' : 'ghost', onClick: () => { this.tab = k; this.render(); } });
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
          const b = new Button(c === 'all' ? '全部' : COLOR_INFO[c].name, { width: 100, height: 44, fontSize: 20, kind: this.filter === c ? 'primary' : 'ghost', onClick: () => { this.filter = c; this.render(); } });
          b.position.set(20 + i * 110, 0);
          this.body.addChild(b);
        });
        const all = sortCards([...content().cards.values()].filter((c) => c.pool !== false && !['token', 'special', 'basic'].includes(c.rarity) && c.type !== 'status' && c.type !== 'curse' && (this.filter === 'all' || c.faction === this.filter)).map((c) => ({ id: c.id, up: false })));
        const found = all.filter((c) => d.cards.has(c.id)).length;
        const cnt = new Text({ text: `收集 ${found}/${all.length}`, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 24, fill: C.goldLight } });
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
        const list = [...content().enemies.values()].filter((e) => e.tier !== 'minion' || d.enemies.has(e.id)).filter((e) => !e.id.startsWith('sandbox')).sort((a, b) => a.act - b.act || ['normal', 'elite', 'boss', 'minion'].indexOf(a.tier) - ['normal', 'elite', 'boss', 'minion'].indexOf(b.tier));
        const per = Math.floor(this.w / 200);
        list.forEach((e, i) => {
          const known = d.enemies.has(e.id);
          const c = new Container();
          c.position.set(20 + (i % per) * 200, 10 + Math.floor(i / per) * 240);
          const bg = new Graphics();
          drawPanel(bg, 184, 224, { r: 12, border: e.tier === 'boss' ? 0xff7a5a : e.tier === 'elite' ? 0xe0a050 : C.goldDark });
          c.addChild(bg);
          const m = new Graphics().roundRect(6, 6, 172, 172, 10).fill(0xffffff);
          assets.with(K.enemy(e.id, e.tier === 'boss'), (t) => { const s = new Sprite(t); const k = Math.min(170 / t.height, 170 / t.width); s.scale.set(k); s.anchor.set(0.5, 1); s.position.set(92, 178); c.addChild(m); s.mask = m; if (!known) { s.tint = 0; s.alpha = 0.6; } c.addChildAt(s, 1); });
          const n = new Text({ text: known ? e.name : '？？？', style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 22, fill: C.text } });
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
          const bg = new Graphics().circle(0, 0, 46).fill({ color: 0x0d0907, alpha: 0.7 }).stroke({ width: 2, color: r.tier === 'boss' ? 0xff7a5a : C.goldDark });
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
      case 'commanders': {
        const box = new ScrollBox(this.w, H);
        let y = 10;
        for (const cm of content().commanders.values()) {
          const st = session.profile.commanderStats[cm.id];
          const unlocked = session.profile.unlocked.commanders.includes(cm.id);
          const t = new Text({ text: `${unlocked ? cm.name : '？？？'} 「${cm.title}」 · ${COLOR_INFO[cm.faction].school}`, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 30, fill: factionColor(cm.faction), stroke: { color: 0, width: 4 } } });
          t.position.set(20, y);
          box.content.addChild(t);
          y += 44;
          const body = unlocked ? `${cm.lore}${st?.wins ? `\n\n【结局】${cm.ending}` : '\n\n（以此主帅通关后解锁结局）'}` : '尚未解锁。';
          const bt = new Text({ text: body, style: { fontFamily: FONT_BODY, fontSize: 21, fill: C.text, wordWrap: true, wordWrapWidth: this.w - 80, lineHeight: 34, breakWords: true } });
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
          const l = new Text({ text: `${SUIT_INFO[s].name}（${SUIT_INFO[s].yang ? '阳' : '阴'}）`, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 26, fill: SUIT_INFO[s].color } });
          l.position.set(20, 30 + row * 150);
          this.body.addChild(l);
          for (let r = 1; r <= 13; r++) {
            const v = new FateCardView({ suit: s, rank: r, id: r });
            v.scale.set(0.62);
            v.position.set(230 + (r - 1) * 96, 80 + row * 150);
            this.body.addChild(v);
          }
        });
        const n = new Text({ text: '天命牌堆共 52 张，每场战斗重新洗混，双方共享。观星台、遗物与事件可以增删改冒险中的天命牌；逆命 13 起混入「凶兆」。', style: { fontFamily: FONT_BODY, fontSize: 20, fill: C.textDim, wordWrap: true, wordWrapWidth: this.w - 60 } });
        n.position.set(20, 640);
        this.body.addChild(n);
        break;
      }
      case 'world': case 'rules': {
        const entries = this.tab === 'world' ? (world as { title: string; text: string; category?: string }[]) : (rules as { title: string; text: string }[]);
        const box = new ScrollBox(this.w, H);
        let y = 10;
        for (const e of entries) {
          const t = new Text({ text: `${'category' in e && e.category ? `［${e.category}］` : ''}${e.title}`, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 30, fill: C.goldLight } });
          t.position.set(20, y);
          box.content.addChild(t);
          y += 44;
          const bt = new Text({ text: e.text.replace(/\[|\]/g, ''), style: { fontFamily: FONT_BODY, fontSize: 21, fill: C.text, wordWrap: true, wordWrapWidth: this.w - 80, lineHeight: 34, breakWords: true } });
          bt.position.set(40, y);
          box.content.addChild(bt);
          y += bt.height + 26;
        }
        box.refresh();
        this.body.addChild(box);
        break;
      }
      case 'history': {
        const hs = session.profile.history;
        if (!hs.length) { const t = new Text({ text: '尚无对局记录。', style: { fontFamily: FONT_BODY, fontSize: 26, fill: C.textDim } }); t.position.set(40, 40); this.body.addChild(t); break; }
        const box = new ScrollBox(this.w, H);
        hs.forEach((h, i) => {
          const cm = content().commanders.get(h.commander);
          const row = new Container();
          row.position.set(20, 10 + i * 70);
          const bg = new Graphics();
          drawPanel(bg, this.w - 60, 60, { r: 8, alpha: 0.7, inner: false });
          row.addChild(bg);
          const res = h.result === 'win' ? '通关' : h.result === 'abandon' ? '放弃' : '败北';
          const t = new Text({ text: `${new Date(h.date).toLocaleString('zh-CN')}　${cm?.name ?? h.commander}　逆命${h.ascension}　${res}　第${h.act}幕第${h.floor}层　命数+${h.score}　种子 ${h.seed}`, style: { fontFamily: FONT_BODY, fontSize: 20, fill: h.result === 'win' ? 0x9adfa8 : C.text } });
          t.position.set(16, 16);
          row.addChild(t);
          const cp = new Button('复制种子', { width: 130, height: 44, fontSize: 18, kind: 'ghost', onClick: () => { void navigator.clipboard?.writeText(h.seed); toast('已复制种子'); } });
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

export class CodexScene extends Scene {
  override async enter() {
    await assets.load(K.bg('codex'));
    G.setBackdrop(assets.get(K.bg('codex')), 0x6a6a6a);
    audio.playMusic('camp');
    const t = title('图　鉴', 56);
    t.anchor.set(0.5, 0); t.position.set(960, 14);
    const back = new Button('← 返回', { width: 150, height: 56, fontSize: 22, kind: 'ghost', onClick: () => void import('./title').then((m) => G.go(new m.TitleScene())) });
    back.position.set(24, 20);
    const bg = panelSurface(1860, 960, true);
    bg.position.set(30, 100);
    const panel = new CodexPanel(1820, 920);
    panel.position.set(50, 120);
    this.addChild(bg, panel, t, back);
  }
}

export function openCodexModal() {
  const m = new Modal(1800, 1000, { title: '图鉴' });
  const p = new CodexPanel(1740, 860);
  p.position.set(30, 110);
  m.body.addChild(p);
}
