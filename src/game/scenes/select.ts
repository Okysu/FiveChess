/** 主帅选择 (UI研究笔记 §14.6) */
import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { panelSurface } from '../ui/skin';
import { G, Scene } from '../core/app';
import { assets, K } from '../assets';
import { Box } from '../core/layout';
import { Button, Tooltip, glossLines, hideTip, label, showTip, title } from '../ui/widgets';
import { C, FONT_BODY, FONT_NUM, FONT_TITLE, factionColor } from '../ui/theme';
import { content } from '../../engine/content';
import type { CommanderDef, Color } from '../../engine/defs';
import { COLOR_INFO } from '../../engine/glossary';
import { drawPanel } from '../ui/draw';
import { richTexture } from '../ui/richtext';
import { CardView } from '../ui/card';
import { tweens, ease } from '../core/tween';
import { session } from '../state';
import { audio, sfx } from '../audio/audio';
import { TextInput } from '../ui/input';
import { drawPip } from '../ui/canvasIcons';
import { CanvasSource, Texture } from 'pixi.js';
import { go } from '../router';
import { inspectCard, termsOf } from '../ui/hud';
import { UNLOCK_TRACK } from '../../engine/meta';

const SKILL_TYPE: Record<string, string> = { passive: '被动', active: '主动', limited: '限定技', awaken: '觉醒技' };

export class SelectScene extends Scene {
  private portrait = new Container();
  private details = new Container();
  private list = new Container();
  private selected: CommanderDef;
  private asc = 0;
  private ascText!: Text;
  private seed!: TextInput;
  private breath = 0;
  private startBtn!: Button;

  constructor() {
    super();
    const unlocked = session.profile.unlocked.commanders;
    const all = [...content().commanders.values()];
    this.selected = all.find((c) => unlocked.includes(c.id)) ?? all[0]!;
  }

  override async enter() {
    const heroes = [...content().commanders.values()].map((c) => K.hero(c.id));
    await assets.loadMany([K.bg('recruit'), ...heroes]);
    G.setBackdrop(assets.get(K.bg('recruit')), 0x6a6a6a);
    audio.playMusic('camp');
    const back = new Button('← 返回', { width: 150, height: 56, fontSize: 22, kind: 'ghost', onClick: () => void import('./title').then((m) => G.go(new m.TitleScene())) });
    back.position.set(24, 20);
    const head = title('选择主帅', 52);
    head.anchor.set(0.5, 0);
    head.position.set(960, 14);
    this.addChild(this.portrait, this.details, this.list, back, head);
    this.buildList();
    this.showCommander(this.selected);
    // ascension + seed + start
    const bottom = new Box({ dir: 'row', gap: 20, align: 'center' });
    bottom.add(label('逆命', { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 30, fill: C.goldLight }));
    bottom.add(new Button('◀', { width: 56, height: 56, kind: 'ghost', onClick: () => this.setAsc(this.asc - 1) }), { width: 56, height: 56 });
    this.ascText = new Text({ text: '0', style: { fontFamily: FONT_NUM, fontSize: 34, fill: C.goldLight, fontWeight: 'bold' } });
    bottom.add(this.ascText, { width: 50, height: 44 });
    bottom.add(new Button('▶', { width: 56, height: 56, kind: 'ghost', onClick: () => this.setAsc(this.asc + 1) }), { width: 56, height: 56 });
    this.seed = new TextInput(260, 56, '种子（可留空）');
    bottom.add(this.seed, { width: 260, height: 56 });
    this.startBtn = new Button('启　程', { width: 260, height: 80, fontSize: 36, kind: 'primary', onClick: () => this.start() });
    bottom.add(this.startBtn, { width: 260, height: 80 });
    bottom.layout();
    bottom.position.set(1880 - bottom.w, 975);
    this.addChild(bottom);
    this.setAsc(0);
  }

  private setAsc(v: number) {
    const max = session.profile.ascension[this.selected.id] ?? 0;
    this.asc = Math.max(0, Math.min(max, v));
    this.ascText.text = String(this.asc);
  }

  private buildList() {
    this.list.removeChildren();
    const groups: Color[] = ['R', 'B', 'G', 'Y', 'P'];
    let x = 30;
    const unlocked = session.profile.unlocked.commanders;
    for (const f of groups) {
      const cmds = [...content().commanders.values()].filter((c) => c.faction === f);
      const tag = new Text({ text: COLOR_INFO[f].name, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 30, fill: factionColor(f), stroke: { color: 0, width: 4 } } });
      tag.position.set(x, 900);
      this.list.addChild(tag);
      x += 40;
      for (const c of cmds) {
        const locked = !unlocked.includes(c.id);
        const card = new Container();
        card.position.set(x, 870);
        const bg = new Graphics();
        drawPanel(bg, 110, 150, { r: 10, fill: 0x2a1f19, border: c.id === this.selected.id ? C.goldLight : C.goldDark });
        card.addChild(bg);
        const m = new Graphics().roundRect(4, 4, 102, 142, 8).fill(0xffffff);
        assets.with(K.hero(c.id), (t) => {
          const s = new Sprite(t);
          const k = 150 / (t.height * 0.45);
          s.scale.set(k);
          s.position.set(55 - (t.width * k) / 2, -8);
          card.addChild(m);
          s.mask = m;
          if (locked) { s.tint = 0x000000; s.alpha = 0.7; }
          card.addChildAt(s, 1);
        });
        const nm = new Text({ text: locked ? '？？？' : c.name, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 22, fill: C.text, stroke: { color: 0, width: 4 } } });
        nm.anchor.set(0.5, 1);
        nm.position.set(55, 144);
        card.addChild(nm);
        card.eventMode = 'static';
        card.cursor = 'pointer';
        card.on('pointertap', () => {
          if (locked) { sfx('deny'); return; }
          this.selected = c;
          sfx('click');
          this.buildList();
          this.showCommander(c);
          this.setAsc(this.asc);
        });
        if (locked) {
          const step = UNLOCK_TRACK.find((s) => s.commanders?.includes(c.id));
          card.on('pointerover', (e) => showTip(new Tooltip([{ title: '未解锁', body: step ? `累计命数达到 ${step.xp} 后解锁（当前 ${session.profile.xp}）。` : '继续冒险以解锁。' }]), e.global.x, 700, 'above'));
          card.on('pointerout', hideTip);
        }
        this.list.addChild(card);
        x += 124;
      }
      x += 20;
    }
  }

  private showCommander(c: CommanderDef) {
    // portrait
    this.portrait.removeChildren();
    const glow = new Graphics().ellipse(450, 900, 380, 80).fill({ color: factionColor(c.faction), alpha: 0.25 });
    this.portrait.addChild(glow);
    const tex = assets.get(K.hero(c.id));
    if (tex) {
      const s = new Sprite(tex);
      s.anchor.set(0.5, 1);
      const k = Math.min(760 / tex.height, 860 / tex.width);
      s.scale.set(k);
      s.position.set(460, 880);
      s.alpha = 0;
      this.portrait.addChild(s);
      void tweens.to(s, { alpha: 1 }, 350, { unscaled: true });
      (this.portrait as Container & { hero?: Sprite }).hero = s;
    }
    // details
    this.details.removeChildren();
    const panelW = 900, panelH = 760;
    const bg = panelSurface(panelW, panelH, true);
    this.details.position.set(960, 90);
    this.details.addChild(bg);
    const nm = new Text({ text: c.name, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 64, fill: C.goldLight, stroke: { color: 0, width: 6 } } });
    nm.position.set(36, 20);
    const tt = new Text({ text: `「${c.title}」`, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 32, fill: factionColor(c.faction), stroke: { color: 0, width: 4 } } });
    tt.position.set(40 + nm.width, 44);
    this.details.addChild(nm, tt);
    const info = new Text({ text: `${COLOR_INFO[c.faction].school}　生命 ${c.hp}　初始源`, style: { fontFamily: FONT_BODY, fontSize: 24, fill: C.text } });
    info.position.set(40, 110);
    this.details.addChild(info);
    const cv = document.createElement('canvas');
    cv.width = 64 * c.sources.length; cv.height = 64;
    const ctx = cv.getContext('2d')!;
    c.sources.forEach((col, i) => drawPip(ctx, col, 32 + i * 64, 32, 22));
    const pips = new Sprite(new Texture({ source: new CanvasSource({ resource: cv, resolution: 2 }) }));
    pips.position.set(48 + info.width, 106);
    this.details.addChild(pips);
    let y = 160;
    for (const sk of c.skills) {
      const h = new Text({ text: `【${SKILL_TYPE[sk.type]}】${sk.name}`, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 28, fill: sk.type === 'passive' ? C.goldLight : 0xff9a6a } });
      h.position.set(40, y);
      this.details.addChild(h);
      y += 40;
      const { texture, result } = richTexture(sk.text, { width: panelW - 90, height: 140, fontSize: 21, minFontSize: 16, color: 0xeadfc8, align: 'left', vAlign: 'top' });
      const s = new Sprite(texture);
      s.position.set(56, y);
      s.eventMode = 'static';
      s.on('pointerover', (e) => { const g = glossLines(termsOf(sk.text)); if (g.length) showTip(new Tooltip(g), e.global.x, e.global.y); });
      s.on('pointerout', hideTip);
      this.details.addChild(s);
      y += result.usedHeight + 16;
    }
    const relic = content().relics.get(c.relic);
    if (relic) {
      const h = new Text({ text: `专属遗物：${relic.name}`, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 26, fill: C.goldLight } });
      h.position.set(40, y);
      this.details.addChild(h);
      y += 36;
      const { texture, result } = richTexture(relic.text, { width: panelW - 90, height: 100, fontSize: 20, color: 0xd8ccb4, align: 'left', vAlign: 'top' });
      const s = new Sprite(texture);
      s.position.set(56, y);
      this.details.addChild(s);
      y += result.usedHeight + 16;
    }
    // starter deck mini-cards
    const deckLbl = new Text({ text: `初始牌组（${c.deck.length}）`, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 24, fill: C.textDim } });
    deckLbl.position.set(40, Math.max(y, 540));
    this.details.addChild(deckLbl);
    const uniq = [...new Set(c.deck)];
    uniq.forEach((id, i) => {
      const v = new CardView({ id, up: false });
      v.scale.set(0.34);
      v.position.set(80 + i * 112, Math.max(y, 540) + 120);
      v.eventMode = 'static';
      v.cursor = 'pointer';
      v.on('pointertap', () => inspectCard(id, false));
      const n = c.deck.filter((x) => x === id).length;
      if (n > 1) {
        const badge = new Text({ text: `×${n}`, style: { fontFamily: FONT_NUM, fontSize: 60, fontWeight: 'bold', fill: C.goldLight, stroke: { color: 0, width: 8 } } });
        badge.anchor.set(1, 1);
        badge.position.set(300, 420);
        v.addChild(badge);
      }
      this.details.addChild(v);
    });
    const st = session.profile.commanderStats[c.id];
    const stats = new Text({ text: st ? `战绩：出征 ${st.runs} · 通关 ${st.wins} · 最高逆命 ${st.highestAsc} · 最远 ${st.bestFloor} 层` : '尚无战绩', style: { fontFamily: FONT_BODY, fontSize: 20, fill: C.textDim } });
    stats.position.set(40, panelH - 44);
    this.details.addChild(stats);
    const lore = new Text({ text: c.lore, style: { fontFamily: FONT_BODY, fontSize: 19, fill: C.textDim, wordWrap: true, wordWrapWidth: 420, lineHeight: 30, breakWords: true } });
    lore.position.set(40, 100);
    lore.alpha = 0.85;
    const loreBox = new Container();
    const lb = new Graphics().roundRect(0, 0, 460, lore.height + 30, 12).fill({ color: 0x000000, alpha: 0.5 });
    loreBox.addChild(lb);
    lore.position.set(20, 15);
    loreBox.addChild(lore);
    loreBox.position.set(30, 110);
    this.portrait.addChild(loreBox);
  }

  private start() {
    session.startRun(this.selected.id, this.asc, this.seed.value);
    sfx('turnPlayer');
    void go(true);
  }

  override update(dt: number) {
    this.breath += dt;
    const hero = (this.portrait as Container & { hero?: Sprite }).hero;
    if (hero) { const k = Math.sin(this.breath / 900) * 0.008; hero.scale.y = hero.scale.x * (1 + k); }
    this.seed?.tick(dt);
  }
}

export { ease };
